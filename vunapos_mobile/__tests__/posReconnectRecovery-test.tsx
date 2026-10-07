import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

import {
  PosCachedResourceClient,
  usePosCachedResource,
} from "@/hooks/usePosCachedResource";
import { PosCacheKey, posCache } from "@/services/posCache";
import { invalidateOperationalPosCache } from "@/services/posCacheInvalidation";
import {
  recoverPosResources,
  registerOperationalCacheRecovery,
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

it("repairs the root-owned cache before refreshing mounted views", async () => {
  const calls: string[] = [];
  const historyCache = freshCache("history", () => calls.push("mounted history"));
  const hook = await renderHook(() => usePosCachedResource({
    cache: historyCache,
    cacheKey: { resource: "invoice-history", scope },
    connectionStatus: "online",
    load: jest.fn(),
  }));
  await waitFor(() => expect(hook.result.current.data).toBe("history"));
  const unregisterReference = registerRealtimeControlRefresh("referenceDataChanged", () => {
    calls.push("reference");
  });
  const unregisterRecovery = registerOperationalCacheRecovery(async () => {
    calls.push("persisted operational cache");
  });
  try {
    await act(async () => recoverPosResources("reconnect"));
    expect(calls).toEqual(["reference", "persisted operational cache", "mounted history"]);
  } finally {
    unregisterRecovery();
    unregisterReference();
  }
});

it("marks unmounted persisted data stale without touching another profile", async () => {
  const historyKey: PosCacheKey = { resource: "invoice-history", scope };
  const otherProfileKey: PosCacheKey = {
    resource: "invoice-history",
    scope: { ...scope, posProfile: "Other POS" },
  };
  await posCache.write(historyKey, { invoices: ["SINV-001"] }, 60_000);
  await posCache.write(otherProfileKey, { invoices: ["SINV-002"] }, 60_000);
  expect((await posCache.read(historyKey))?.isStale).toBe(false);

  const unregisterReference = registerRealtimeControlRefresh("referenceDataChanged", () => {});
  const unregisterRecovery = registerOperationalCacheRecovery(() =>
    invalidateOperationalPosCache({
      companyUrl: scope.companyUrl,
      posProfile: scope.posProfile,
      sessionId: scope.userId,
    }),
  );
  try {
    await recoverPosResources("reconnect");
    expect((await posCache.read(historyKey))?.data).toEqual({ invoices: ["SINV-001"] });
    expect((await posCache.read(historyKey))?.isStale).toBe(true);
    expect((await posCache.read(otherProfileKey))?.isStale).toBe(false);
  } finally {
    unregisterRecovery();
    unregisterReference();
    await posCache.clearNamespace(scope);
    await posCache.clearNamespace(otherProfileKey.scope);
  }
});

it("still refreshes mounted views when persisted-cache repair fails", async () => {
  const historyCache = freshCache("history");
  const hook = await renderHook(() => usePosCachedResource({
    cache: historyCache,
    cacheKey: { resource: "invoice-history", scope },
    connectionStatus: "online",
    load: jest.fn(),
  }));
  await waitFor(() => expect(hook.result.current.data).toBe("history"));
  const unregisterReference = registerRealtimeControlRefresh("referenceDataChanged", () => {});
  const unregisterRecovery = registerOperationalCacheRecovery(async () => {
    throw new Error("SQLite unavailable");
  });
  try {
    await act(async () => recoverPosResources("reconnect"));
    expect(historyCache.fetch).toHaveBeenCalledTimes(1);
    expect(hook.result.current.data).toBe("history refreshed");
  } finally {
    unregisterRecovery();
    unregisterReference();
  }
});
