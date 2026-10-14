import { recordCacheDiagnostic } from "@/services/cacheDiagnostics";
import { openPosDatabase } from "@/services/posDatabase";

/**
 * The cache is deliberately scoped more narrowly than the device. A caller
 * must identify the signed-in account and POS profile; transaction drafts also
 * include their ERP company and warehouse so a changed profile cannot restore
 * an unverified cart from the old operational scope.
 */
export type PosCacheScope = {
  companyUrl: string;
  posProfile: string;
  userId: string;
  /** ERP company and warehouse are required for transaction-draft persistence. */
  company?: string;
  warehouse?: string;
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
  ): Promise<void>;
  write(entry: StoredCacheEntry): Promise<void>;
  /** Optional atomic replacement used by SQLite-backed production storage. */
  writeAndPrune?: (
    entry: StoredCacheEntry,
    maximumEntries: number,
    maximumBytes: number,
  ) => Promise<void>;
};

export type PosCacheOptions = {
  maximumBytesPerNamespace?: number;
  maximumEntryBytes?: number;
  maximumEntriesPerNamespace?: number;
  now?: () => number;
  schemaVersion?: number;
};

export class SupersededCacheRequestError extends Error {
  constructor() {
    super("This cached request was superseded.");
  }
}

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
    company: scope.company,
    companyUrl: scope.companyUrl,
    posProfile: scope.posProfile,
    userId: scope.userId,
    warehouse: scope.warehouse,
  });
}

export function posCacheKey(key: PosCacheKey) {
  return stableJson({
    namespace: posCacheNamespace(key.scope),
    query: key.query,
    resource: key.resource,
  });
}

function resourceScopeKey(namespace: string, resource: string) {
  return `${namespace}\u0000${resource}`;
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

  async writeAndPrune(
    entry: StoredCacheEntry,
    maximumEntries: number,
    maximumBytes: number,
  ) {
    const database = await this.database();
    await database.withTransactionAsync(async () => {
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
      await database.runAsync(
        `DELETE FROM pos_cache_entries
         WHERE cache_key IN (
           SELECT cache_key FROM pos_cache_entries
           WHERE namespace = ?
           ORDER BY accessed_at DESC
           LIMIT -1 OFFSET ?
         )`,
        entry.namespace,
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
        entry.namespace,
        maximumBytes,
      );
    });
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
    // Make the rows unreadable durably before attempting physical deletion.
    // A failed DELETE must not resurrect a revoked workspace on process restart.
    await database.runAsync(
      "UPDATE pos_cache_entries SET schema_version = 0 WHERE namespace = ? AND resource = ?",
      namespace,
      resource,
    );
    try {
      await database.runAsync(
        "DELETE FROM pos_cache_entries WHERE namespace = ? AND resource = ?",
        namespace,
        resource,
      );
    } catch {
      // Incompatible rows remain bounded by normal namespace pruning and can
      // no longer hydrate as an authorized snapshot.
    }
  }

  async prune(
    namespace: string,
    maximumEntries: number,
    maximumBytes: number,
  ) {
    const database = await this.database();
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
  private readonly inFlight = new Map<string, {
    invalidated: boolean;
    namespace: string;
    promise: Promise<unknown>;
    resource: string;
  }>();
  private readonly listeners = new Map<string, Set<(event: "write" | "clear") => void>>();
  private readonly memory = new Map<string, StoredCacheEntry>();
  private clearGeneration = 0;
  /** Failed explicit clears hide old durable rows until each key is replaced by a live write. */
  private readonly blockedResourceRows = new Map<string, Set<string>>();
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
    const blockedRows = this.blockedResourceRows.get(
      resourceScopeKey(posCacheNamespace(key.scope), key.resource),
    );
    if (blockedRows && !blockedRows.has(cacheKey)) return null;
    let stored = this.memory.get(cacheKey);
    let source: "memory" | "sqlite" = "memory";

    if (!stored) {
      const clearGeneration = this.clearGeneration;
      try {
        const durable = await this.storage.get(cacheKey) ?? undefined;
        // A clear must not be undone by a read started before it. A write
        // completed during the read is newer than the row SQLite returned.
        stored = this.memory.get(cacheKey) ??
          (clearGeneration === this.clearGeneration ? durable : undefined);
        source = "sqlite";
        if (stored) this.memory.set(cacheKey, stored);
      } catch {
        stored = this.memory.get(cacheKey);
        if (stored) {
          source = "memory";
        } else {
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

  async write<T>(
    key: PosCacheKey,
    data: T,
    ttlMs: number,
    isCurrent: () => boolean = () => true,
  ) {
    if (!isCurrent()) return;
    const clearGeneration = this.clearGeneration;
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
      if (this.storage.writeAndPrune) {
        await this.storage.writeAndPrune(
          entry,
          this.maximumEntriesPerNamespace,
          this.maximumBytesPerNamespace,
        );
      } else {
        await this.storage.write(entry);
        await this.storage.prune(
          entry.namespace,
          this.maximumEntriesPerNamespace,
          this.maximumBytesPerNamespace,
        );
      }
    } catch {
      if (!isCurrent()) {
        await this.delete(entry.cacheKey);
        return;
      }
      // A first live response may still be useful for this running process
      // when persistence is unavailable. Once a previous snapshot exists,
      // restore it so a failed refresh cannot replace approved data.
      if (previousEntry) this.memory.set(entry.cacheKey, previousEntry);
      try {
        if (previousEntry) await this.storage.write(previousEntry);
        else await this.storage.delete(entry.cacheKey);
      } catch {
        // The durable store may be unavailable; retain the live candidate only
        // when there was no prior approved snapshot.
      }
      if (!previousEntry && clearGeneration === this.clearGeneration) {
        // The live server result is still safe to show in this process after
        // an explicit clear, even when SQLite cannot persist it.
        this.blockedResourceRows.get(resourceScopeKey(entry.namespace, entry.resource))
          ?.add(entry.cacheKey);
      }
      recordCacheDiagnostic({
        operation: "write",
        outcome: "error",
        resource: key.resource,
        source: "sqlite",
      });
      return;
    }
    if (!isCurrent()) {
      // A profile/session may have been cleared while SQLite was committing.
      // Do not publish that obsolete snapshot to mounted readers.
      await this.delete(entry.cacheKey);
      return;
    }
    if (clearGeneration === this.clearGeneration) {
      this.blockedResourceRows.get(resourceScopeKey(entry.namespace, entry.resource))
        ?.add(entry.cacheKey);
    }
    // Publish the new snapshot only after the durable replacement succeeds.
    // A failed SQLite write leaves the previous in-memory and durable entries
    // available to stale-while-revalidate readers.
    for (const listener of this.listeners.get(entry.cacheKey) ?? []) listener("write");
    this.pruneMemory(entry.namespace);
    recordCacheDiagnostic({
      operation: "write",
      outcome: "success",
      resource: key.resource,
      rowsWritten: cachedRowCount(data),
      source: "sqlite",
    });
  }

  /** Allows mounted resource hooks to observe targeted cache patches. */
  subscribe(key: PosCacheKey, listener: (event: "write" | "clear") => void) {
    const cacheKey = posCacheKey(key);
    const listeners = this.listeners.get(cacheKey) ?? new Set<(event: "write" | "clear") => void>();
    listeners.add(listener);
    this.listeners.set(cacheKey, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(cacheKey);
    };
  }

  /** Shares the one live request for a resource between all interested views. */
  async fetch<T>(
    key: PosCacheKey,
    loader: () => Promise<T>,
    ttlMs: number,
    options?: { afterCurrent?: boolean },
  ): Promise<T> {
    const startedAt = Date.now();
    const cacheKey = posCacheKey(key);
    const existing = this.inFlight.get(cacheKey);
    if (existing) {
      if (options?.afterCurrent || existing.invalidated) {
        // A full rebootstrap must not adopt an older delta response. A request
        // invalidated by a scope change must not become the new scope's data.
        return existing.promise.catch(() => undefined).then(() =>
          this.fetch<T>(key, loader, ttlMs, options),
        );
      }
      recordCacheDiagnostic({
        operation: "fetch",
        outcome: "deduplicated",
        resource: key.resource,
        source: "network",
      });
      return existing.promise as Promise<T>;
    }

    const entry = {
      invalidated: false,
      namespace: posCacheNamespace(key.scope),
      promise: Promise.resolve() as Promise<unknown>,
      resource: key.resource,
    };
    const request = loader()
      .then(async (data) => {
        if (entry.invalidated) throw new SupersededCacheRequestError();
        await this.write(key, data, ttlMs, () => !entry.invalidated);
        if (entry.invalidated) {
          throw new SupersededCacheRequestError();
        }
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
      .finally(() => {
        if (this.inFlight.get(cacheKey) === entry) this.inFlight.delete(cacheKey);
      });
    entry.promise = request;
    this.inFlight.set(cacheKey, entry);
    return request;
  }

  async clearNamespace(scope: PosCacheScope) {
    this.clearGeneration += 1;
    const namespace = posCacheNamespace(scope);
    for (const entry of this.inFlight.values()) {
      if (entry.namespace === namespace) entry.invalidated = true;
    }
    for (const [cacheKey, entry] of this.memory) {
      if (entry.namespace === namespace) {
        this.memory.delete(cacheKey);
      }
    }
    try {
      await this.storage.clearNamespace(namespace);
      for (const key of this.blockedResourceRows.keys()) {
        if (key.startsWith(`${namespace}\u0000`)) this.blockedResourceRows.delete(key);
      }
    } catch {
      // Cache cleanup cannot block a sign-out or company change.
    }
    for (const [cacheKey, listeners] of this.listeners) {
      const listenerKey = JSON.parse(cacheKey) as { namespace: string };
      if (listenerKey.namespace === namespace) {
        for (const listener of listeners) listener("clear");
      }
    }
    recordCacheDiagnostic({ operation: "clear", outcome: "success", resource: "namespace" });
  }

  /** Used when the active account changes, so no POS data outlives its owner. */
  async clearAll() {
    this.clearGeneration += 1;
    for (const entry of this.inFlight.values()) entry.invalidated = true;
    this.memory.clear();
    try {
      await this.storage.clearAll();
      this.blockedResourceRows.clear();
    } catch {
      // A cache cleanup failure must not block sign-out or company switching.
    }
    for (const listeners of this.listeners.values()) {
      for (const listener of listeners) listener("clear");
    }
    this.listeners.clear();
    recordCacheDiagnostic({ operation: "clear", outcome: "success", resource: "all" });
  }

  async clearResource(scope: PosCacheScope, resource: string) {
    this.clearGeneration += 1;
    const namespace = posCacheNamespace(scope);
    const blockedKey = resourceScopeKey(namespace, resource);
    this.blockedResourceRows.set(blockedKey, new Set());
    for (const entry of this.inFlight.values()) {
      if (entry.namespace === namespace && entry.resource === resource) {
        entry.invalidated = true;
      }
    }
    for (const [cacheKey, entry] of this.memory) {
      if (entry.namespace === namespace && entry.resource === resource) {
        this.memory.delete(cacheKey);
      }
    }
    let clearedDurably = false;
    try {
      await this.storage.clearResource(namespace, resource);
      this.blockedResourceRows.delete(blockedKey);
      clearedDurably = true;
    } catch {
      // The in-process block is only provisional. Callers clearing an access
      // boundary must fail closed if SQLite could not durably invalidate it.
    }
    for (const [cacheKey, listeners] of this.listeners) {
      const entryKey = JSON.parse(cacheKey) as { namespace: string; resource: string };
      if (entryKey.namespace === namespace && entryKey.resource === resource) {
        for (const listener of listeners) listener("clear");
      }
    }
    recordCacheDiagnostic({
      operation: "clear", outcome: clearedDurably ? "success" : "error", resource,
    });
    return clearedDurably;
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

  private pruneMemory(namespace: string) {
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
