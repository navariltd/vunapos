import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

import {
  PosCachedResourceClient,
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

  it("reports a useful offline state when no cached record exists", async () => {
    const cache = createCache<string[]>(null, Promise.resolve(["milk"]));
    const hook = await renderHook(() =>
      usePosCachedResource({ cache, cacheKey: key, connectionStatus: "offline", load: jest.fn() }),
    );

    await waitFor(() => expect(hook.result.current.error).toContain("offline"));
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
