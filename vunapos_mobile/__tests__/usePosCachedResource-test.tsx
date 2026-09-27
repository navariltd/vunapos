import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

import {
  PosCachedResourceClient,
  refreshRegisteredPosResources,
  usePosCachedResource,
} from "@/hooks/usePosCachedResource";
import { PosCacheEntry, PosCacheKey } from "@/services/posCache";

afterEach(cleanup);

const key: PosCacheKey = {
  resource: "catalogue",
  scope: {
    companyUrl: "https://acme.example.com",
    posProfile: "Main POS",
    userId: "cashier@example.com",
  },
};

function cached<T>(data: T, isStale = false): PosCacheEntry<T> {
  return { data, expiresAt: 2_000, fetchedAt: 1_000, isStale };
}

function createCache<T>(entry: PosCacheEntry<T> | null, fetchResult: Promise<T>) {
  const client = {
    fetch: jest.fn(() => fetchResult),
    read: jest.fn().mockResolvedValue(entry),
  };
  return client as typeof client & PosCachedResourceClient;
}

describe("usePosCachedResource", () => {
  it("reports loading while its first asynchronous cache read hydrates", async () => {
    let resolveRead: ((value: PosCacheEntry<string[]> | null) => void) | undefined;
    const cache = {
      fetch: jest.fn(),
      read: jest.fn(
        () =>
          new Promise<PosCacheEntry<string[]> | null>((resolve) => {
            resolveRead = resolve;
          }),
      ),
    } as PosCachedResourceClient;
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "online", load: jest.fn() }),
    );

    expect(hook.result.current).toMatchObject({
      data: null,
      error: null,
      isLoading: true,
    });

    resolveRead?.(cached(["milk"]));
    await waitFor(() => expect(hook.result.current.data).toEqual(["milk"]));
    expect(hook.result.current.isLoading).toBe(false);
  });

  it("does not expose data from an earlier query while the next key hydrates", async () => {
    let resolveSecondRead: ((value: PosCacheEntry<string[]> | null) => void) | undefined;
    const secondKey: PosCacheKey = { ...key, query: "bread" };
    const cache = {
      fetch: jest.fn(),
      read: jest.fn((requestedKey: PosCacheKey) => {
        if (requestedKey.query === "bread") {
          return new Promise<PosCacheEntry<string[]> | null>((resolve) => {
            resolveSecondRead = resolve;
          });
        }
        return Promise.resolve(cached(["milk"]));
      }),
    } as PosCachedResourceClient;
    const hook = await renderHook<
      ReturnType<typeof usePosCachedResource<string[]>>,
      { cacheKey: PosCacheKey }
    >(
      ({ cacheKey }) =>
        usePosCachedResource({ cache, cacheKey, connectionStatus: "online", load: jest.fn() }),
      { initialProps: { cacheKey: key } },
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["milk"]));
    await hook.rerender({ cacheKey: secondKey });
    expect(hook.result.current).toMatchObject({
      data: null,
      error: null,
      isLoading: true,
    });

    resolveSecondRead?.(cached(["bread"]));
    await waitFor(() => expect(hook.result.current.data).toEqual(["bread"]));
  });

  it("does not flash a previous company or POS profile while the new scope hydrates", async () => {
    let resolveSecondRead: ((value: PosCacheEntry<string[]> | null) => void) | undefined;
    const secondKey: PosCacheKey = {
      ...key,
      scope: {
        ...key.scope,
        companyUrl: "https://other.example.com",
        posProfile: "Secondary POS",
        userId: "other-session",
      },
    };
    const cache = {
      fetch: jest.fn(),
      read: jest.fn((requestedKey: PosCacheKey) => {
        if (requestedKey.scope.companyUrl === secondKey.scope.companyUrl) {
          return new Promise<PosCacheEntry<string[]> | null>((resolve) => {
            resolveSecondRead = resolve;
          });
        }
        return Promise.resolve(cached(["company A item"]));
      }),
    } as PosCachedResourceClient;
    const hook = await renderHook<
      ReturnType<typeof usePosCachedResource<string[]>>,
      { cacheKey: PosCacheKey }
    >(
      ({ cacheKey }) =>
        usePosCachedResource({
          cache,
          cacheKey,
          connectionStatus: "online",
          load: jest.fn(),
        }),
      { initialProps: { cacheKey: key } },
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["company A item"]));
    await hook.rerender({ cacheKey: secondKey });
    expect(hook.result.current).toMatchObject({ data: null, isLoading: true });

    resolveSecondRead?.(cached(["company B item"]));
    await waitFor(() => expect(hook.result.current.data).toEqual(["company B item"]));
  });

  it("uses a fresh cached value without making a server request", async () => {
    const cache = createCache(cached(["milk"]), Promise.resolve(["fresh milk"]));
    const load = jest.fn();
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "online", load }),
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["milk"]));
    expect(cache.fetch).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    expect(hook.result.current.isStale).toBe(false);
  });

  it("revalidates a stale resource through the app-level scheduler", async () => {
    let reads = 0;
    const cache = {
      fetch: jest.fn().mockResolvedValue(["new milk"]),
      read: jest.fn(() => {
        reads += 1;
        return Promise.resolve(cached(reads > 1 ? ["old milk"] : ["milk"], reads > 1));
      }),
    } as PosCachedResourceClient;
    const hook = await renderHook(() =>
      usePosCachedResource({
        cache,
        cacheKey: key,
        connectionStatus: "online",
        load: jest.fn(),
        ttlMs: 100,
      }),
    );

    await act(async () => refreshRegisteredPosResources());
    await waitFor(() => expect(cache.fetch).toHaveBeenCalledTimes(1));
    expect(hook.result.current.data).toEqual(["new milk"]);
  });

  it("shows a stale cached value while it refreshes in the background", async () => {
    let resolveRefresh: ((value: string[]) => void) | undefined;
    const cache = createCache(
      cached(["old milk"], true),
      new Promise<string[]>((resolve) => { resolveRefresh = resolve; }),
    );
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "online", load: jest.fn() }),
    );

    await waitFor(() => expect(hook.result.current.isRefreshing).toBe(true));
    expect(hook.result.current.data).toEqual(["old milk"]);
    resolveRefresh?.(["new milk"]);
    await waitFor(() => expect(hook.result.current.data).toEqual(["new milk"]));
  });

  it("shows cached data offline and does not request the server", async () => {
    const cache = createCache(cached(["milk"], true), Promise.resolve(["fresh milk"]));
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "offline", load: jest.fn() }),
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["milk"]));
    expect(hook.result.current.isStale).toBe(true);
    expect(cache.fetch).not.toHaveBeenCalled();
  });

  it("hydrates cached data while reachability is unknown and revalidates it", async () => {
    const cache = createCache(cached(["milk"], true), Promise.resolve(["fresh milk"]));
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "unknown", load: jest.fn() }),
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["fresh milk"]));
    expect(cache.fetch).toHaveBeenCalled();
  });

  it("attempts uncached data while reachability is unknown", async () => {
    const cache = createCache<string[]>(null, Promise.resolve(["milk"]));
    const load = jest.fn().mockResolvedValue(["milk"]);
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "unknown", load }),
    );

    await waitFor(() => expect(hook.result.current.data).toEqual(["milk"]));
    expect(cache.fetch).toHaveBeenCalled();
  });

  it("classifies an uncached offline failure through the loader", async () => {
    const cache = createCache<string[]>(null, Promise.reject(new Error("Network request failed")));
    const load = jest.fn().mockRejectedValue(new Error("Network request failed"));
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "offline", load }),
    );

    await waitFor(() => expect(hook.result.current.error).toBe("Network request failed"));
    expect(hook.result.current.data).toBeNull();
  });

  it("forces a refresh even when the cached value is still fresh", async () => {
    const cache = createCache(cached(["old milk"]), Promise.resolve(["new milk"]));
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "online", load: jest.fn() }),
    );
    await waitFor(() => expect(hook.result.current.data).toEqual(["old milk"]));

    await act(async () => hook.result.current.refresh());

    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.data).toEqual(["new milk"]);
  });

  it("retains useful data when a background refresh fails", async () => {
    const cache = createCache<string[]>(
      cached(["milk"], true),
      Promise.reject(new Error("Network unavailable")),
    );
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "online", load: jest.fn() }),
    );

    await waitFor(() => expect(hook.result.current.error).toBe("Network unavailable"));
    expect(hook.result.current.data).toEqual(["milk"]);
    expect(hook.result.current.isLoading).toBe(false);
  });
});
