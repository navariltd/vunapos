import * as SQLite from "expo-sqlite";

/**
 * The cache is deliberately scoped more narrowly than the device. A caller
 * must identify the signed-in account and POS profile so one cashier cannot
 * browse another cashier's data after a company or profile change.
 */
export type PosCacheScope = {
  companyUrl: string;
  posProfile: string;
  userId: string;
};

export type PosCacheKey = {
  query?: unknown;
  resource: string;
  scope: PosCacheScope;
};

export type PosCacheEntry<T> = {
  data: T;
  expiresAt: number;
  fetchedAt: number;
  isStale: boolean;
};

type StoredCacheEntry = {
  accessedAt: number;
  cacheKey: string;
  expiresAt: number;
  fetchedAt: number;
  namespace: string;
  payload: string;
  resource: string;
  schemaVersion: number;
};

type CacheStorage = {
  clearNamespace(namespace: string): Promise<void>;
  clearResource(namespace: string, resource: string): Promise<void>;
  delete(cacheKey: string): Promise<void>;
  get(cacheKey: string): Promise<StoredCacheEntry | null>;
  prune(namespace: string, maximumEntries: number, now: number): Promise<void>;
  write(entry: StoredCacheEntry): Promise<void>;
};

export type PosCacheOptions = {
  maximumEntriesPerNamespace?: number;
  now?: () => number;
  schemaVersion?: number;
};

const CACHE_DATABASE_NAME = "vunapos-cache.db";
const CACHE_SCHEMA_VERSION = 1;
const CACHE_DATABASE_SCHEMA_VERSION = 1;
const DEFAULT_MAXIMUM_ENTRIES_PER_NAMESPACE = 80;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function posCacheNamespace(scope: PosCacheScope) {
  return stableJson({
    companyUrl: scope.companyUrl,
    posProfile: scope.posProfile,
    userId: scope.userId,
  });
}

export function posCacheKey(key: PosCacheKey) {
  return stableJson({
    namespace: posCacheNamespace(key.scope),
    query: key.query,
    resource: key.resource,
  });
}

class ExpoSqliteCacheStorage implements CacheStorage {
  private databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

  private async database() {
    if (!this.databasePromise) {
      this.databasePromise = SQLite.openDatabaseAsync(CACHE_DATABASE_NAME).then(
        async (database) => {
          const version = await database.getFirstAsync<{ user_version: number }>(
            "PRAGMA user_version",
          );
          if ((version?.user_version ?? 0) !== CACHE_DATABASE_SCHEMA_VERSION) {
            await database.execAsync("DROP TABLE IF EXISTS pos_cache_entries");
          }
          await database.execAsync(`
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS pos_cache_entries (
              cache_key TEXT PRIMARY KEY NOT NULL,
              namespace TEXT NOT NULL,
              resource TEXT NOT NULL,
              schema_version INTEGER NOT NULL,
              payload TEXT NOT NULL,
              fetched_at INTEGER NOT NULL,
              expires_at INTEGER NOT NULL,
              accessed_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pos_cache_namespace_accessed
              ON pos_cache_entries(namespace, accessed_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pos_cache_namespace_resource
              ON pos_cache_entries(namespace, resource);
            CREATE INDEX IF NOT EXISTS idx_pos_cache_expires_at
              ON pos_cache_entries(expires_at);
          `);
          await database.execAsync(
            `PRAGMA user_version = ${CACHE_DATABASE_SCHEMA_VERSION}`,
          );
          return database;
        },
      );
    }
    return this.databasePromise;
  }

  async get(cacheKey: string): Promise<StoredCacheEntry | null> {
    const database = await this.database();
    const row = await database.getFirstAsync<{
      accessed_at: number;
      cache_key: string;
      expires_at: number;
      fetched_at: number;
      namespace: string;
      payload: string;
      resource: string;
      schema_version: number;
    }>(
      `SELECT cache_key, namespace, resource, schema_version, payload, fetched_at, expires_at, accessed_at
       FROM pos_cache_entries WHERE cache_key = ?`,
      cacheKey,
    );
    if (!row) return null;
    return {
      accessedAt: row.accessed_at,
      cacheKey: row.cache_key,
      expiresAt: row.expires_at,
      fetchedAt: row.fetched_at,
      namespace: row.namespace,
      payload: row.payload,
      resource: row.resource,
      schemaVersion: row.schema_version,
    };
  }

  async write(entry: StoredCacheEntry) {
    const database = await this.database();
    await database.runAsync(
      `INSERT OR REPLACE INTO pos_cache_entries
        (cache_key, namespace, resource, schema_version, payload, fetched_at, expires_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      entry.cacheKey,
      entry.namespace,
      entry.resource,
      entry.schemaVersion,
      entry.payload,
      entry.fetchedAt,
      entry.expiresAt,
      entry.accessedAt,
    );
  }

  async delete(cacheKey: string) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE cache_key = ?",
      cacheKey,
    );
  }

  async clearNamespace(namespace: string) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE namespace = ?",
      namespace,
    );
  }

  async clearResource(namespace: string, resource: string) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE namespace = ? AND resource = ?",
      namespace,
      resource,
    );
  }

  async prune(namespace: string, maximumEntries: number, now: number) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE expires_at < ?",
      now,
    );
    await database.runAsync(
      `DELETE FROM pos_cache_entries
       WHERE cache_key IN (
         SELECT cache_key FROM pos_cache_entries
         WHERE namespace = ?
         ORDER BY accessed_at DESC
         LIMIT -1 OFFSET ?
       )`,
      namespace,
      maximumEntries,
    );
  }
}

/**
 * A small, cache-only data layer. Cache failures are intentionally swallowed:
 * a database problem must never prevent the live POS from making a request.
 */
export class PosCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly memory = new Map<string, StoredCacheEntry>();
  private readonly maximumEntriesPerNamespace: number;
  private readonly now: () => number;
  private readonly schemaVersion: number;

  constructor(
    private readonly storage: CacheStorage,
    options: PosCacheOptions = {},
  ) {
    this.maximumEntriesPerNamespace =
      options.maximumEntriesPerNamespace ??
      DEFAULT_MAXIMUM_ENTRIES_PER_NAMESPACE;
    this.now = options.now ?? Date.now;
    this.schemaVersion = options.schemaVersion ?? CACHE_SCHEMA_VERSION;
  }

  async read<T>(key: PosCacheKey): Promise<PosCacheEntry<T> | null> {
    const cacheKey = posCacheKey(key);
    let stored = this.memory.get(cacheKey);

    if (!stored) {
      try {
        stored = await this.storage.get(cacheKey) ?? undefined;
        if (stored) this.memory.set(cacheKey, stored);
      } catch {
        return null;
      }
    }

    if (!stored || stored.schemaVersion !== this.schemaVersion) {
      if (stored) await this.delete(cacheKey);
      return null;
    }

    try {
      const data = JSON.parse(stored.payload) as T;
      return {
        data,
        expiresAt: stored.expiresAt,
        fetchedAt: stored.fetchedAt,
        isStale: stored.expiresAt <= this.now(),
      };
    } catch {
      await this.delete(cacheKey);
      return null;
    }
  }

  async write<T>(key: PosCacheKey, data: T, ttlMs: number) {
    const now = this.now();
    const entry: StoredCacheEntry = {
      accessedAt: now,
      cacheKey: posCacheKey(key),
      expiresAt: now + ttlMs,
      fetchedAt: now,
      namespace: posCacheNamespace(key.scope),
      payload: JSON.stringify(data),
      resource: key.resource,
      schemaVersion: this.schemaVersion,
    };
    this.memory.set(entry.cacheKey, entry);

    try {
      await this.storage.write(entry);
      await this.storage.prune(
        entry.namespace,
        this.maximumEntriesPerNamespace,
        now,
      );
    } catch {
      // The in-memory entry is still useful for this session.
    }
  }

  /** Shares the one live request for a resource between all interested views. */
  async fetch<T>(key: PosCacheKey, loader: () => Promise<T>, ttlMs: number) {
    const cacheKey = posCacheKey(key);
    const existing = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (existing) return existing;

    const request = loader()
      .then(async (data) => {
        await this.write(key, data, ttlMs);
        return data;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  async clearNamespace(scope: PosCacheScope) {
    const namespace = posCacheNamespace(scope);
    for (const [cacheKey, entry] of this.memory) {
      if (entry.namespace === namespace) this.memory.delete(cacheKey);
    }
    try {
      await this.storage.clearNamespace(namespace);
    } catch {
      // Cache cleanup cannot block a sign-out or company change.
    }
  }

  async clearResource(scope: PosCacheScope, resource: string) {
    const namespace = posCacheNamespace(scope);
    for (const [cacheKey, entry] of this.memory) {
      if (entry.namespace === namespace && entry.resource === resource) {
        this.memory.delete(cacheKey);
      }
    }
    try {
      await this.storage.clearResource(namespace, resource);
    } catch {
      // Invalidating browse data must never block a successful mutation.
    }
  }

  private async delete(cacheKey: string) {
    this.memory.delete(cacheKey);
    try {
      await this.storage.delete(cacheKey);
    } catch {
      // A corrupt durable entry should not stop a live read.
    }
  }
}

export const posCache = new PosCache(new ExpoSqliteCacheStorage());
