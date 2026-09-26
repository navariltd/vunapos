import { recordCacheDiagnostic } from "@/services/cacheDiagnostics";
import { openPosDatabase } from "@/services/posDatabase";

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
  clearAll(): Promise<void>;
  clearNamespace(namespace: string): Promise<void>;
  clearResource(namespace: string, resource: string): Promise<void>;
  delete(cacheKey: string): Promise<void>;
  get(cacheKey: string): Promise<StoredCacheEntry | null>;
  markResourceStale(namespace: string, resource: string): Promise<void>;
  prune(
    namespace: string,
    maximumEntries: number,
    maximumBytes: number,
    now: number,
  ): Promise<void>;
  write(entry: StoredCacheEntry): Promise<void>;
};

export type PosCacheOptions = {
  maximumBytesPerNamespace?: number;
  maximumEntryBytes?: number;
  maximumEntriesPerNamespace?: number;
  now?: () => number;
  schemaVersion?: number;
};

const CACHE_SCHEMA_VERSION = 1;
const DEFAULT_MAXIMUM_BYTES_PER_NAMESPACE = 5_000_000;
const DEFAULT_MAXIMUM_ENTRY_BYTES = 2_000_000;
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

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function cachedRowCount(value: unknown) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const collections = ["items", "customers", "invoices", "payments"];
  const count = collections.reduce(
    (total, field) =>
      total + (Array.isArray(record[field]) ? record[field].length : 0),
    0,
  );
  return count || undefined;
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
  private async database() {
    return openPosDatabase();
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

  async markResourceStale(namespace: string, resource: string) {
    const database = await this.database();
    await database.runAsync(
      "UPDATE pos_cache_entries SET expires_at = 0 WHERE namespace = ? AND resource = ?",
      namespace,
      resource,
    );
  }

  async clearNamespace(namespace: string) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE namespace = ?",
      namespace,
    );
  }

  async clearAll() {
    const database = await this.database();
    await database.execAsync("DELETE FROM pos_cache_entries");
  }

  async clearResource(namespace: string, resource: string) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE namespace = ? AND resource = ?",
      namespace,
      resource,
    );
  }

  async prune(
    namespace: string,
    maximumEntries: number,
    maximumBytes: number,
    now: number,
  ) {
    const database = await this.database();
    await database.runAsync(
      "DELETE FROM pos_cache_entries WHERE expires_at <= ?",
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
    await database.runAsync(
      `DELETE FROM pos_cache_entries
       WHERE cache_key IN (
         SELECT cache_key FROM (
           SELECT
             cache_key,
             SUM(LENGTH(CAST(payload AS BLOB))) OVER (
               ORDER BY accessed_at DESC, cache_key DESC
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS cumulative_payload_bytes
           FROM pos_cache_entries
           WHERE namespace = ?
         )
         WHERE cumulative_payload_bytes > ?
       )`,
      namespace,
      maximumBytes,
    );
  }
}

/**
 * A small, cache-only data layer. Cache failures are intentionally swallowed:
 * a database problem must never prevent the live POS from making a request.
 */
export class PosCache {
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly memory = new Map<string, StoredCacheEntry>();
  private readonly maximumBytesPerNamespace: number;
  private readonly maximumEntryBytes: number;
  private readonly maximumEntriesPerNamespace: number;
  private readonly now: () => number;
  private readonly schemaVersion: number;

  constructor(
    private readonly storage: CacheStorage,
    options: PosCacheOptions = {},
  ) {
    this.maximumBytesPerNamespace =
      options.maximumBytesPerNamespace ?? DEFAULT_MAXIMUM_BYTES_PER_NAMESPACE;
    this.maximumEntryBytes =
      options.maximumEntryBytes ?? DEFAULT_MAXIMUM_ENTRY_BYTES;
    this.maximumEntriesPerNamespace =
      options.maximumEntriesPerNamespace ??
      DEFAULT_MAXIMUM_ENTRIES_PER_NAMESPACE;
    this.now = options.now ?? Date.now;
    this.schemaVersion = options.schemaVersion ?? CACHE_SCHEMA_VERSION;
  }

  async read<T>(key: PosCacheKey): Promise<PosCacheEntry<T> | null> {
    const startedAt = Date.now();
    const cacheKey = posCacheKey(key);
    let stored = this.memory.get(cacheKey);
    let source: "memory" | "sqlite" = "memory";

    if (!stored) {
      try {
        stored = await this.storage.get(cacheKey) ?? undefined;
        source = "sqlite";
        if (stored) this.memory.set(cacheKey, stored);
      } catch {
        recordCacheDiagnostic({
          durationMs: Date.now() - startedAt,
          operation: "read",
          outcome: "error",
          resource: key.resource,
          source: "sqlite",
        });
        return null;
      }
    }

    if (!stored || stored.schemaVersion !== this.schemaVersion) {
      if (stored) await this.delete(cacheKey);
      recordCacheDiagnostic({
        durationMs: Date.now() - startedAt,
        operation: "read",
        outcome: "miss",
        resource: key.resource,
        source,
      });
      return null;
    }

    try {
      const data = JSON.parse(stored.payload) as T;
      const isStale = stored.expiresAt <= this.now();
      recordCacheDiagnostic({
        durationMs: Date.now() - startedAt,
        operation: "read",
        outcome: isStale ? "stale" : "hit",
        resource: key.resource,
        source,
      });
      return {
        data,
        expiresAt: stored.expiresAt,
        fetchedAt: stored.fetchedAt,
        isStale,
      };
    } catch {
      await this.delete(cacheKey);
      recordCacheDiagnostic({
        durationMs: Date.now() - startedAt,
        operation: "read",
        outcome: "error",
        resource: key.resource,
        source,
      });
      return null;
    }
  }

  async write<T>(key: PosCacheKey, data: T, ttlMs: number) {
    const now = this.now();
    const payload = JSON.stringify(data);
    if (utf8ByteLength(payload) > this.maximumEntryBytes) {
      recordCacheDiagnostic({
        operation: "write",
        outcome: "skipped",
        resource: key.resource,
      });
      return;
    }
    const entry: StoredCacheEntry = {
      accessedAt: now,
      cacheKey: posCacheKey(key),
      expiresAt: now + ttlMs,
      fetchedAt: now,
      namespace: posCacheNamespace(key.scope),
      payload,
      resource: key.resource,
      schemaVersion: this.schemaVersion,
    };
    const previousEntry = this.memory.get(entry.cacheKey);
    // Keep reads responsive while SQLite commits, but do not notify mounted
    // resources until the durable replacement succeeds. The candidate is
    // rolled back if the write fails.
    this.memory.set(entry.cacheKey, entry);
    try {
      await this.storage.write(entry);
      await this.storage.prune(
        entry.namespace,
        this.maximumEntriesPerNamespace,
        this.maximumBytesPerNamespace,
        now,
      );
    } catch {
      // A first live response may still be useful for this running process
      // when persistence is unavailable. Once a previous snapshot exists,
      // restore it so a failed refresh cannot replace approved data.
      if (previousEntry) this.memory.set(entry.cacheKey, previousEntry);
      recordCacheDiagnostic({
        operation: "write",
        outcome: "error",
        resource: key.resource,
        source: "sqlite",
      });
      return;
    }
    // Publish the new snapshot only after the durable replacement succeeds.
    // A failed SQLite write leaves the previous in-memory and durable entries
    // available to stale-while-revalidate readers.
    for (const listener of this.listeners.get(entry.cacheKey) ?? []) listener();
    this.pruneMemory(entry.namespace, now);
    recordCacheDiagnostic({
      operation: "write",
      outcome: "success",
      resource: key.resource,
      rowsWritten: cachedRowCount(data),
      source: "sqlite",
    });
  }

  /** Allows mounted resource hooks to observe targeted cache patches. */
  subscribe(key: PosCacheKey, listener: () => void) {
    const cacheKey = posCacheKey(key);
    const listeners = this.listeners.get(cacheKey) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(cacheKey, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(cacheKey);
    };
  }

  /** Shares the one live request for a resource between all interested views. */
  async fetch<T>(key: PosCacheKey, loader: () => Promise<T>, ttlMs: number) {
    const startedAt = Date.now();
    const cacheKey = posCacheKey(key);
    const existing = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (existing) {
      recordCacheDiagnostic({
        operation: "fetch",
        outcome: "deduplicated",
        resource: key.resource,
        source: "network",
      });
      return existing;
    }

    const request = loader()
      .then(async (data) => {
        await this.write(key, data, ttlMs);
        recordCacheDiagnostic({
          durationMs: Date.now() - startedAt,
          operation: "fetch",
          outcome: "success",
          resource: key.resource,
          source: "network",
        });
        return data;
      })
      .catch((error: unknown) => {
        recordCacheDiagnostic({
          durationMs: Date.now() - startedAt,
          operation: "fetch",
          outcome: "error",
          resource: key.resource,
          source: "network",
        });
        throw error;
      })
      .finally(() => this.inFlight.delete(cacheKey));
    this.inFlight.set(cacheKey, request);
    return request;
  }

  async clearNamespace(scope: PosCacheScope) {
    const namespace = posCacheNamespace(scope);
    for (const [cacheKey, entry] of this.memory) {
      if (entry.namespace === namespace) {
        this.memory.delete(cacheKey);
        this.listeners.delete(cacheKey);
      }
    }
    try {
      await this.storage.clearNamespace(namespace);
    } catch {
      // Cache cleanup cannot block a sign-out or company change.
    }
    recordCacheDiagnostic({ operation: "clear", outcome: "success", resource: "namespace" });
  }

  /** Used when the active account changes, so no POS data outlives its owner. */
  async clearAll() {
    this.memory.clear();
    this.listeners.clear();
    try {
      await this.storage.clearAll();
    } catch {
      // A cache cleanup failure must not block sign-out or company switching.
    }
    recordCacheDiagnostic({ operation: "clear", outcome: "success", resource: "all" });
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
    recordCacheDiagnostic({ operation: "clear", outcome: "success", resource });
  }

  /**
   * Keeps saved browse data available offline while ensuring the next online
   * reader revalidates it. Mutations must never erase a cashier's only
   * fallback view merely because connectivity is intermittent.
   */
  async markResourceStale(scope: PosCacheScope, resource: string) {
    const namespace = posCacheNamespace(scope);
    for (const entry of this.memory.values()) {
      if (entry.namespace === namespace && entry.resource === resource) {
        entry.expiresAt = 0;
      }
    }
    try {
      await this.storage.markResourceStale(namespace, resource);
    } catch {
      // Cache invalidation must not turn a successful server mutation into an error.
    }
    recordCacheDiagnostic({ operation: "invalidate", outcome: "success", resource });
  }

  private async delete(cacheKey: string) {
    this.memory.delete(cacheKey);
    try {
      await this.storage.delete(cacheKey);
    } catch {
      // A corrupt durable entry should not stop a live read.
    }
  }

  private pruneMemory(namespace: string, now: number) {
    for (const [cacheKey, entry] of this.memory) {
      if (entry.expiresAt <= now) this.memory.delete(cacheKey);
    }

    const namespaceEntries = [...this.memory.values()]
      .filter((entry) => entry.namespace === namespace)
      .sort((left, right) => {
        if (left.accessedAt !== right.accessedAt) {
          return right.accessedAt - left.accessedAt;
        }
        return right.cacheKey.localeCompare(left.cacheKey);
      });
    let retainedBytes = 0;
    for (const [index, entry] of namespaceEntries.entries()) {
      retainedBytes += utf8ByteLength(entry.payload);
      if (
        retainedBytes > this.maximumBytesPerNamespace ||
        index >= this.maximumEntriesPerNamespace
      ) {
        this.memory.delete(entry.cacheKey);
      }
    }
  }
}

export const posCache = new PosCache(new ExpoSqliteCacheStorage());
