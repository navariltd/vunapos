import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

import {
  PosCachedResourceClient,
  usePosCachedResource,
} from "@/hooks/usePosCachedResource";
import { PosCacheKey } from "@/services/posCache";
import {
  recoverPosResources,
  registerRealtimeControlRefresh,
} from "@/sync/realtimeInvalidation";

afterEach(cleanup);

const scope = {
  companyUrl: "https://pos.example.com",
  posProfile: "Main POS",
  userId: "sid-1",
};

function freshCache(value: string, onFetch?: () => void) {
  const cache = {
    read: jest.fn().mockResolvedValue({
      data: value,
      expiresAt: Date.now() + 60_000,
      fetchedAt: Date.now(),
      isStale: false,
    }),
    fetch: jest.fn(async () => {
      onFetch?.();
      return `${value} refreshed`;
    }),
  };
  return cache as typeof cache & PosCachedResourceClient;
}

it("refreshes mounted operational data after reference data, even with a stale offline hint", async () => {
  const calls: string[] = [];
  const workspaceCache = freshCache("workspace");
  const historyCache = freshCache("history", () => calls.push("history"));
  const workspaceKey: PosCacheKey = {
    resource: "workspace-configuration",
    scope: { ...scope, posProfile: "workspace" },
  };
  const historyKey: PosCacheKey = { resource: "invoice-history", scope };
  const hook = await renderHook(() => ({
    workspace: usePosCachedResource({
      cache: workspaceCache,
      cacheKey: workspaceKey,
      connectionStatus: "offline",
      load: jest.fn(),
    }),
    history: usePosCachedResource({
      cache: historyCache,
      cacheKey: historyKey,
      connectionStatus: "offline",
      load: jest.fn(),
    }),
  }));
  await waitFor(() => expect(hook.result.current.history.data).toBe("history"));
  expect(historyCache.fetch).not.toHaveBeenCalled();

  const unregister = registerRealtimeControlRefresh("referenceDataChanged", () => {
    calls.push("reference");
  });
  try {
    await act(async () => recoverPosResources("reconnect"));
    expect(calls).toEqual(["reference", "history"]);
    expect(historyCache.fetch).toHaveBeenCalledTimes(1);
    expect(workspaceCache.fetch).not.toHaveBeenCalled();
    expect(hook.result.current.history.data).toBe("history refreshed");
  } finally {
    unregister();
  }
});

it("keeps the last operational snapshot when reconnect repair fails", async () => {
  const cache = freshCache("history");
  cache.fetch.mockRejectedValueOnce(new Error("Connection interrupted"));
  const hook = await renderHook(() =>
    usePosCachedResource({
      cache,
      cacheKey: { resource: "invoice-history", scope },
      connectionStatus: "online",
      load: jest.fn(),
    }),
  );
  await waitFor(() => expect(hook.result.current.data).toBe("history"));

  await act(async () => recoverPosResources("reconnect"));

  expect(cache.fetch).toHaveBeenCalledTimes(1);
  expect(hook.result.current.data).toBe("history");
  expect(hook.result.current.error).toBe("Connection interrupted");
});
