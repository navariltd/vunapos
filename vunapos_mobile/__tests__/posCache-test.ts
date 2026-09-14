import {
  PosCache,
  PosCacheKey,
  PosCacheScope,
  posCacheKey,
} from "@/services/posCache";

type StoredEntry = {
  accessedAt: number;
  cacheKey: string;
  expiresAt: number;
  fetchedAt: number;
  namespace: string;
  payload: string;
  resource: string;
  schemaVersion: number;
};

class MemoryStorage {
  entries = new Map<string, StoredEntry>();

  async clearAll() {
    this.entries.clear();
  }

  async clearNamespace(namespace: string) {
    for (const [key, entry] of this.entries) {
      if (entry.namespace === namespace) this.entries.delete(key);
    }
  }

  async clearResource(namespace: string, resource: string) {
    for (const [key, entry] of this.entries) {
      if (entry.namespace === namespace && entry.resource === resource) {
        this.entries.delete(key);
      }
    }
  }

  async delete(cacheKey: string) {
    this.entries.delete(cacheKey);
  }

  async get(cacheKey: string) {
    return this.entries.get(cacheKey) ?? null;
  }

  async markResourceStale(namespace: string, resource: string) {
    for (const entry of this.entries.values()) {
      if (entry.namespace === namespace && entry.resource === resource) {
        entry.expiresAt = 0;
      }
    }
  }

  async prune(namespace: string, maximumEntries: number, now: number) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt < now) this.entries.delete(key);
    }
    const candidates = [...this.entries.values()]
      .filter((entry) => entry.namespace === namespace)
      .sort((left, right) => right.accessedAt - left.accessedAt);
    for (const entry of candidates.slice(maximumEntries)) {
      this.entries.delete(entry.cacheKey);
    }
  }

  async write(entry: StoredEntry) {
    this.entries.set(entry.cacheKey, entry);
  }
}

const scope: PosCacheScope = {
  companyUrl: "https://acme.example.com",
  posProfile: "Main POS",
  userId: "cashier@example.com",
};
const key: PosCacheKey = { resource: "catalogue", scope };

describe("PosCache", () => {
  let now = 1_000;
  let storage: MemoryStorage;
  let cache: PosCache;

  beforeEach(() => {
    now = 1_000;
    storage = new MemoryStorage();
    cache = new PosCache(storage, { now: () => now, maximumEntriesPerNamespace: 2 });
  });

  it("creates stable keys and isolates companies, users, profiles, and queries", () => {
    expect(posCacheKey({ ...key, query: { page: 1, search: "milk" } })).toBe(
      posCacheKey({ ...key, query: { search: "milk", page: 1 } }),
    );
    expect(posCacheKey({ ...key, scope: { ...scope, userId: "other@example.com" } })).not.toBe(
      posCacheKey(key),
    );
  });

  it("returns a fresh entry without treating it as stale", async () => {
    await cache.write(key, { items: ["milk"] }, 3_600);

    await expect(cache.read<{ items: string[] }>(key)).resolves.toEqual({
      data: { items: ["milk"] },
      expiresAt: 4_600,
      fetchedAt: 1_000,
      isStale: false,
    });
  });

  it("keeps a stale record available for stale-while-revalidate views", async () => {
    await cache.write(key, ["milk"], 10);
    now = 1_010;

    await expect(cache.read<string[]>(key)).resolves.toMatchObject({
      data: ["milk"],
      isStale: true,
    });
  });

  it("discards a corrupt durable value safely", async () => {
    const cacheKey = posCacheKey(key);
    storage.entries.set(cacheKey, {
      accessedAt: now,
      cacheKey,
      expiresAt: now + 1_000,
      fetchedAt: now,
      namespace: JSON.stringify(scope),
      payload: "not-json",
      resource: "catalogue",
      schemaVersion: 1,
    });

    await expect(cache.read(key)).resolves.toBeNull();
    expect(storage.entries.has(cacheKey)).toBe(false);
  });

  it("bounds durable records and clears only the requested namespace", async () => {
    await cache.write({ ...key, query: 1 }, 1, 1_000);
    now += 1;
    await cache.write({ ...key, query: 2 }, 2, 1_000);
    now += 1;
    await cache.write({ ...key, query: 3 }, 3, 1_000);
    const otherKey: PosCacheKey = {
      ...key,
      scope: { ...scope, posProfile: "Secondary POS" },
    };
    await cache.write(otherKey, 4, 1_000);

    expect(storage.entries.size).toBe(3);
    await cache.clearNamespace(scope);

    await expect(cache.read(key)).resolves.toBeNull();
    await expect(cache.read(otherKey)).resolves.toMatchObject({ data: 4 });
  });

  it("clears all query variants for only the requested resource", async () => {
    await cache.write({ ...key, query: "milk" }, ["milk"], 1_000);
    await cache.write({ ...key, query: "bread" }, ["bread"], 1_000);
    const invoices: PosCacheKey = { ...key, resource: "invoices" };
    await cache.write(invoices, ["SINV-1"], 1_000);

    await cache.clearResource(scope, "catalogue");

    await expect(cache.read({ ...key, query: "milk" })).resolves.toBeNull();
    await expect(cache.read({ ...key, query: "bread" })).resolves.toBeNull();
    await expect(cache.read(invoices)).resolves.toMatchObject({ data: ["SINV-1"] });
  });

  it("marks only the requested resource stale while keeping it readable offline", async () => {
    await cache.write({ ...key, query: "milk" }, ["milk"], 1_000);
    const invoices: PosCacheKey = { ...key, resource: "invoice-history" };
    await cache.write(invoices, ["SINV-1"], 1_000);

    await cache.markResourceStale(scope, "catalogue");

    await expect(cache.read({ ...key, query: "milk" })).resolves.toMatchObject({
      data: ["milk"],
      isStale: true,
    });
    await expect(cache.read(invoices)).resolves.toMatchObject({
      data: ["SINV-1"],
      isStale: false,
    });
  });

  it("never marks matching resource queries stale outside the active company, profile, and user", async () => {
    cache = new PosCache(storage, { now: () => now, maximumEntriesPerNamespace: 10 });
    const activeCatalogue: PosCacheKey = { ...key, query: "milk" };
    const activeOtherQuery: PosCacheKey = { ...key, query: "bread" };
    const otherProfile: PosCacheKey = {
      ...key,
      query: "milk",
      scope: { ...scope, posProfile: "Secondary POS" },
    };
    const otherCompany: PosCacheKey = {
      ...key,
      query: "milk",
      scope: { ...scope, companyUrl: "https://other.example.com" },
    };
    const otherUser: PosCacheKey = {
      ...key,
      query: "milk",
      scope: { ...scope, userId: "other@example.com" },
    };
    await Promise.all([
      cache.write(activeCatalogue, ["milk"], 1_000),
      cache.write(activeOtherQuery, ["bread"], 1_000),
      cache.write(otherProfile, ["profile milk"], 1_000),
      cache.write(otherCompany, ["company milk"], 1_000),
      cache.write(otherUser, ["user milk"], 1_000),
    ]);

    await cache.markResourceStale(scope, "catalogue");

    await expect(cache.read(activeCatalogue)).resolves.toMatchObject({ isStale: true });
    await expect(cache.read(activeOtherQuery)).resolves.toMatchObject({ isStale: true });
    await expect(cache.read(otherProfile)).resolves.toMatchObject({ isStale: false });
    await expect(cache.read(otherCompany)).resolves.toMatchObject({ isStale: false });
    await expect(cache.read(otherUser)).resolves.toMatchObject({ isStale: false });
  });

  it("clears memory and durable data on an account change", async () => {
    await cache.write(key, ["milk"], 1_000);

    await cache.clearAll();

    await expect(cache.read(key)).resolves.toBeNull();
    expect(storage.entries.size).toBe(0);
  });

  it("shares simultaneous live requests for a resource", async () => {
    let resolveRequest: ((value: string[]) => void) | undefined;
    const loader = jest.fn(
      () => new Promise<string[]>((resolve) => { resolveRequest = resolve; }),
    );

    const first = cache.fetch(key, loader, 1_000);
    const second = cache.fetch(key, loader, 1_000);
    resolveRequest?.(["milk"]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      ["milk"],
      ["milk"],
    ]);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
