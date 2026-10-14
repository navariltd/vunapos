import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react-native";
import { useEffect, useState } from "react";
import { Text, TextInput } from "react-native";

import { PosCachedResourceClient, usePosCachedResource } from "@/hooks/usePosCachedResource";
import { PosCache, PosCacheKey, posCacheKey } from "@/services/posCache";
import { PosBootstrapSnapshotBoundary } from "@/sync/PosBootstrapSnapshot";
import { usePosRefreshTriggers } from "@/sync/usePosRefreshTriggers";
import type { PosBootstrapState } from "@/features/pos/hooks/usePosBootstrap";

jest.mock("@/components/splash/AppLaunchScreen", () => ({
  AppLaunchScreen: ({ message }: { message: string }) => {
    const { Text } = require("react-native");
    return <Text>{message}</Text>;
  },
}));

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({
    authState: "signedIn",
    companyUrl: "https://example.test",
    sessionId: "sid-a",
  }),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

jest.mock("@/services/frappeClient", () => ({
  validateFrappeSession: jest.fn().mockResolvedValue("valid"),
}));

type Row = {
  accessedAt: number;
  cacheKey: string;
  expiresAt: number;
  fetchedAt: number;
  namespace: string;
  payload: string;
  resource: string;
  schemaVersion: number;
};

/** In-memory stand-in for SQLite retention and scheduler interaction. */
class InvestigativeStorage {
  rows = new Map<string, Row>();
  failReads = false;

  async clearAll() { this.rows.clear(); }
  async clearNamespace(namespace: string) {
    for (const [key, row] of this.rows) if (row.namespace === namespace) this.rows.delete(key);
  }
  async clearResource(namespace: string, resource: string) {
    for (const [key, row] of this.rows) {
      if (row.namespace === namespace && row.resource === resource) this.rows.delete(key);
    }
  }
  async delete(key: string) { this.rows.delete(key); }
  async get(key: string) {
    if (this.failReads) throw new Error("SQLite temporarily unavailable");
    return this.rows.get(key) ?? null;
  }
  async markResourceStale(namespace: string, resource: string) {
    for (const row of this.rows.values()) {
      if (row.namespace === namespace && row.resource === resource) row.expiresAt = 0;
    }
  }
  async prune(_namespace: string, _entries: number, _bytes: number) {}
  async write(row: Row) { this.rows.set(row.cacheKey, row); }
}

class DelayedReadStorage extends InvestigativeStorage {
  delayNextRead = false;
  resolveRead: (() => void) | null = null;

  override async get(key: string) {
    if (!this.delayNextRead) return super.get(key);
    this.delayNextRead = false;
    const oldRow = this.rows.get(key) ?? null;
    await new Promise<void>((resolve) => { this.resolveRead = resolve; });
    return oldRow;
  }
}

const key: PosCacheKey = {
  resource: "workspace-configuration",
  scope: { companyUrl: "https://example.test", posProfile: "workspace", userId: "sid-a" },
};

let workspaceMounts = 0;
let workspaceUnmounts = 0;

function Workspace() {
  const [tab, setTab] = useState("Home");
  const [note, setNote] = useState("");
  useEffect(() => {
    workspaceMounts += 1;
    return () => { workspaceUnmounts += 1; };
  }, []);
  return <>
    <Text onPress={() => setTab("Checkout")}>{tab === "Home" ? "Open checkout" : "Checkout"}</Text>
    {tab === "Checkout" ? <TextInput accessibilityLabel="Checkout note" value={note} onChangeText={setNote} /> : null}
  </>;
}

function Scheduler() {
  usePosRefreshTriggers();
  return null;
}

function Root({ cache, connectionStatus = "online", load, scheduled = false }: {
  cache: PosCache;
  connectionStatus?: "online" | "offline";
  load: () => Promise<{ pos_profile: { name: string } }>;
  scheduled?: boolean;
}) {
  const resource = usePosCachedResource({
    cache,
    cacheKey: key,
    connectionStatus,
    load,
    manageFreshness: scheduled,
  });
  return <>
    {scheduled ? <Scheduler /> : null}
    <Text onPress={() => void resource.refresh()}>Refresh workspace</Text>
    <PosBootstrapSnapshotBoundary authState="signedIn" value={{
      ...resource,
      reload: async () => resource.refresh(),
    } as PosBootstrapState}>
      <Workspace />
    </PosBootstrapSnapshotBoundary>
  </>;
}

describe("POS runtime lifecycle investigation and Phase 1 regressions", () => {
  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  beforeEach(() => {
    workspaceMounts = 0;
    workspaceUnmounts = 0;
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-10-08T08:00:00.000Z"));
  });

  it("preserves checkout after expiry, unrelated write, and workspace refresh", async () => {
    const storage = new InvestigativeStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);
    let resolveRefresh!: (value: { pos_profile: { name: string } }) => void;
    const load = jest.fn(() => new Promise<{ pos_profile: { name: string } }>((resolve) => {
      resolveRefresh = resolve;
    }));
    await render(<Root cache={cache} load={load} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByText("Open checkout")).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText("Open checkout")); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText("Checkout note"), "Do not lose this"); });

    jest.setSystemTime(new Date("2026-10-08T08:01:01.000Z"));
    await act(async () => {
      await cache.write({ ...key, resource: "invoice-history" }, [], 60_000);
    });
    expect(storage.rows.has(posCacheKey(key))).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByText("Refresh workspace"));
      await Promise.resolve();
    });
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(workspaceUnmounts).toBe(0);
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Do not lose this");

    await act(async () => { resolveRefresh({ pos_profile: { name: "POS-A" } }); });
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Do not lose this");
    expect(workspaceMounts).toBe(1);
  });

  it("preserves checkout through the actual 60-second freshness scheduler", async () => {
    const storage = new InvestigativeStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);
    let resolveRefresh!: (value: { pos_profile: { name: string } }) => void;
    const load = jest.fn(() => new Promise<{ pos_profile: { name: string } }>((resolve) => {
      resolveRefresh = resolve;
    }));
    await render(<Root cache={cache} load={load} scheduled />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(screen.getByText("Open checkout")); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText("Checkout note"), "Important details"); });

    jest.setSystemTime(new Date("2026-10-08T08:01:01.000Z"));
    await act(async () => { await cache.write({ ...key, resource: "invoice-history" }, [], 60_000); });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await Promise.resolve();
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(workspaceUnmounts).toBe(0);
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Important details");
    await act(async () => { resolveRefresh({ pos_profile: { name: "POS-A" } }); });
  });

  it("preserves checkout after a transient cache-read error", async () => {
    const storage = new InvestigativeStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);
    let resolveRefresh!: (value: { pos_profile: { name: string } }) => void;
    const load = jest.fn(() => new Promise<{ pos_profile: { name: string } }>((resolve) => {
      resolveRefresh = resolve;
    }));
    await render(<Root cache={cache} load={load} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(screen.getByText("Open checkout")); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText("Checkout note"), "Still editing"); });
    // Force the next read to go to SQLite rather than the in-memory entry.
    (cache as unknown as { memory: Map<string, Row> }).memory.delete(posCacheKey(key));
    storage.failReads = true;
    await act(async () => {
      fireEvent.press(screen.getByText("Refresh workspace"));
      await Promise.resolve();
    });
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(workspaceUnmounts).toBe(0);
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Still editing");
    await act(async () => { resolveRefresh({ pos_profile: { name: "POS-A" } }); });
  });

  it("blocks profile revalidation while preserving checkout state", async () => {
    const storage = new InvestigativeStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);
    let resolveRefresh!: (value: { pos_profile: { name: string } }) => void;
    const load = jest.fn(() => new Promise<{ pos_profile: { name: string } }>((resolve) => {
      resolveRefresh = resolve;
    }));
    await render(<Root cache={cache} load={load} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(screen.getByText("Open checkout")); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText("Checkout note"), "In progress"); });

    await act(async () => { await cache.clearResource(key.scope, key.resource); });
    await act(async () => {
      fireEvent.press(screen.getByText("Refresh workspace"));
      await Promise.resolve();
    });
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
    expect(screen.getByText("Checking POS access…")).toBeTruthy();
    expect(workspaceUnmounts).toBe(0);
    expect(screen.getByLabelText("Checkout note").props.value).toBe("In progress");
    await act(async () => { resolveRefresh({ pos_profile: { name: "POS-A" } }); });
    expect(screen.getByLabelText("Checkout note").props.value).toBe("In progress");
    expect(workspaceUnmounts).toBe(0);
  });

  it("discards an older same-scope refresh before it can replace or persist a newer result", async () => {
    let resolveOldRead!: (value: {
      data: string;
      expiresAt: number;
      fetchedAt: number;
      isStale: boolean;
    }) => void;
    const fresh = (data: string) => ({
      data, expiresAt: Date.now() + 60_000, fetchedAt: Date.now(), isStale: false,
    });
    let reads = 0;
    let persisted = "initial";
    const cache = {
      read: jest.fn(() => {
        reads += 1;
        if (reads === 2) return new Promise<ReturnType<typeof fresh>>((resolve) => {
          resolveOldRead = resolve;
        });
        return Promise.resolve(fresh(reads === 1 ? "initial" : "newer"));
      }),
      fetch: jest.fn()
        .mockImplementationOnce(async () => { persisted = "newer"; return "newer"; })
        .mockImplementationOnce(async () => { persisted = "older"; return "older"; }),
    } as PosCachedResourceClient;
    const hook = await renderHook(() => usePosCachedResource({
      cache, cacheKey: key, connectionStatus: "online", load: jest.fn(), manageFreshness: false,
    }));
    await act(async () => { await Promise.resolve(); });
    expect(hook.result.current.data).toBe("initial");

    // Refresh A starts first but is held inside an asynchronous SQLite read.
    await act(async () => { void hook.result.current.refresh(); await Promise.resolve(); });
    // Refresh B reads and commits newer server state first.
    await act(async () => { await hook.result.current.refresh(); });
    expect(hook.result.current.data).toBe("newer");

    await act(async () => { resolveOldRead({ ...fresh("older"), isStale: true }); });
    expect(hook.result.current.data).toBe("newer");
    expect(cache.fetch).toHaveBeenCalledTimes(1);
    expect(persisted).toBe("newer");
  });

  it("keeps checkout mounted across a connection hint change when the snapshot remains cached", async () => {
    const storage = new InvestigativeStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "POS-A" } }, 60_000);
    const load = jest.fn().mockResolvedValue({ pos_profile: { name: "POS-A" } });
    const view = await render(<Root cache={cache} connectionStatus="online" load={load} />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { fireEvent.press(screen.getByText("Open checkout")); });
    await act(async () => { fireEvent.changeText(screen.getByLabelText("Checkout note"), "Keep me"); });

    await view.rerender(<Root cache={cache} connectionStatus="offline" load={load} />);
    await view.rerender(<Root cache={cache} connectionStatus="online" load={load} />);
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Keep me");
    expect(workspaceUnmounts).toBe(0);
    expect(screen.queryByText("Preparing your workspace…")).toBeNull();
  });

  it("does not let a late SQLite read replace a newer in-memory cache write", async () => {
    const storage = new DelayedReadStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "OLD" } }, 60_000);
    (cache as unknown as { memory: Map<string, Row> }).memory.delete(posCacheKey(key));
    storage.delayNextRead = true;
    const oldRead = cache.read<{ pos_profile: { name: string } }>(key);
    await cache.write(key, { pos_profile: { name: "NEW" } }, 60_000);
    storage.resolveRead?.();
    expect((await oldRead)?.data.pos_profile.name).toBe("NEW");
    expect((await cache.read<{ pos_profile: { name: string } }>(key))?.data.pos_profile.name).toBe("NEW");
    expect(JSON.parse(storage.rows.get(posCacheKey(key))!.payload).pos_profile.name).toBe("NEW");
  });

  it("does not rehydrate a cleared workspace from a read started before clearing", async () => {
    const storage = new DelayedReadStorage();
    const cache = new PosCache(storage);
    await cache.write(key, { pos_profile: { name: "OLD" } }, 60_000);
    (cache as unknown as { memory: Map<string, Row> }).memory.delete(posCacheKey(key));
    storage.delayNextRead = true;
    const oldRead = cache.read(key);
    await cache.clearResource(key.scope, key.resource);
    storage.resolveRead?.();
    await expect(oldRead).resolves.toBeNull();
    await expect(cache.read(key)).resolves.toBeNull();
  });
});
