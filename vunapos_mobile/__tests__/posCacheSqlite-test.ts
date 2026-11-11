import { openPosDatabase } from "@/services/posDatabase";
import { posCache } from "@/services/posCache";

jest.mock("@/services/posDatabase", () => ({ openPosDatabase: jest.fn() }));

describe("SQLite cache retention query", () => {
  it("uses bounded namespace pruning without deleting rows at the freshness deadline", async () => {
    const runAsync = jest.fn().mockResolvedValue(undefined);
    jest.mocked(openPosDatabase).mockResolvedValue({
      runAsync,
      withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
    } as never);
    const key = {
      resource: "workspace-configuration",
      scope: { companyUrl: "https://pos.example.test", posProfile: "workspace", userId: "sid" },
    };

    await posCache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);

    expect(runAsync.mock.calls.some(([query]) =>
      String(query).includes("MAX(expires_at, fetched_at + ?) <= ?") ||
      String(query).includes("WHERE expires_at <= ?"),
    )).toBe(false);
    expect(runAsync.mock.calls.some(([query]) => String(query).includes("LIMIT -1 OFFSET ?"))).toBe(true);
    expect(runAsync.mock.calls.some(([query]) => String(query).includes("cumulative_payload_bytes"))).toBe(true);
  });

  it("does not restore an invalidated workspace after deletion fails and the process restarts", async () => {
    type Row = {
      cache_key: string;
      namespace: string;
      resource: string;
      schema_version: number;
      payload: string;
      fetched_at: number;
      expires_at: number;
      accessed_at: number;
    };
    const rows = new Map<string, Row>();
    const database = {
      getFirstAsync: jest.fn(async (_query: string, cacheKey: string) => rows.get(cacheKey) ?? null),
      runAsync: jest.fn(async (query: string, ...args: unknown[]) => {
        if (query.includes("INSERT OR REPLACE INTO pos_cache_entries")) {
          const [cache_key, namespace, resource, schema_version, payload,
            fetched_at, expires_at, accessed_at] = args as [
            string, string, string, number, string, number, number, number,
          ];
          rows.set(cache_key, {
            cache_key, namespace, resource, schema_version, payload,
            fetched_at, expires_at, accessed_at,
          });
        } else if (query.includes("SET schema_version = 0")) {
          const [namespace, resource] = args;
          for (const row of rows.values()) {
            if (row.namespace === namespace && row.resource === resource) row.schema_version = 0;
          }
        } else if (query.includes("DELETE FROM pos_cache_entries WHERE namespace = ? AND resource = ?")) {
          throw new Error("SQLite delete failed after invalidation");
        }
      }),
      withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
    };
    const freshProcessCache = () => {
      jest.resetModules();
      const { openPosDatabase: open } = require("@/services/posDatabase") as typeof import("@/services/posDatabase");
      jest.mocked(open).mockResolvedValue(database as never);
      return (require("@/services/posCache") as typeof import("@/services/posCache")).posCache;
    };
    const key = {
      resource: "workspace-configuration",
      scope: { companyUrl: "https://pos.example.test", posProfile: "workspace", userId: "sid" },
    };
    const firstProcess = freshProcessCache();
    await firstProcess.write(key, { pos_profile: { name: "POS-OLD" } }, 60_000);
    await firstProcess.clearResource(key.scope, key.resource);
    expect(rows.size).toBe(1);

    const restartedProcess = freshProcessCache();
    await expect(restartedProcess.read(key)).resolves.toBeNull();
  });

  it("durably invalidates a departing SID even when SQLite deletion fails", async () => {
    const rows = new Map<string, { cache_key: string; namespace: string; resource: string;
      schema_version: number; payload: string; fetched_at: number; expires_at: number; accessed_at: number }>();
    const database = {
      getFirstAsync: jest.fn(async (_query: string, cacheKey: string) => rows.get(cacheKey) ?? null),
      runAsync: jest.fn(async (query: string, ...args: unknown[]) => {
        if (query.includes("INSERT OR REPLACE INTO pos_cache_entries")) {
          const [cache_key, namespace, resource, schema_version, payload,
            fetched_at, expires_at, accessed_at] = args as [string, string, string, number, string, number, number, number];
          rows.set(cache_key, { cache_key, namespace, resource, schema_version,
            payload, fetched_at, expires_at, accessed_at });
        } else if (query.includes("SET schema_version = 0")) {
          const [companyUrl, userId] = args;
          for (const row of rows.values()) {
            const scope = JSON.parse(row.namespace) as { companyUrl: string; userId: string };
            if (scope.companyUrl === companyUrl && scope.userId === userId) row.schema_version = 0;
          }
        } else if (query.includes("DELETE FROM pos_cache_entries WHERE json_extract")) {
          throw new Error("SQLite delete failed after tombstone");
        }
      }),
      withTransactionAsync: jest.fn(async (callback: () => Promise<void>) => callback()),
    };
    const processCache = () => {
      jest.resetModules();
      const { openPosDatabase: open } = require("@/services/posDatabase") as typeof import("@/services/posDatabase");
      jest.mocked(open).mockResolvedValue(database as never);
      return (require("@/services/posCache") as typeof import("@/services/posCache")).posCache;
    };
    const key = { resource: "active-cart", scope: {
      companyUrl: "https://pos.example.test", posProfile: "POS-1", userId: "sid-old",
      company: "Company A", warehouse: "Main",
    } };
    const first = processCache();
    await first.write(key, { items: ["old sale"] }, 60_000);
    await first.clearSession(key.scope.companyUrl, key.scope.userId);
    expect(rows.size).toBe(1);

    const restarted = processCache();
    await expect(restarted.read(key)).resolves.toBeNull();
  });
});
