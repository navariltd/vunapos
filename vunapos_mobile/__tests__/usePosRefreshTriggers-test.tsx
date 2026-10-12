import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

const mockUseAppSession = jest.fn();
const mockUseNetworkStatus = jest.fn();
const mockGetVunaMethod = jest.fn();
const mockValidateFrappeSession = jest.fn();
const mockRecoverPosResources = jest.fn();
const mockRefreshRegisteredPosResources = jest.fn();
const mockInvalidateSession = jest.fn();
const mockListener = jest.fn();
let appStateCallback: ((state: "active" | "background") => void) | undefined;

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => mockUseAppSession(),
}));
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));
jest.mock("@/services/frappeClient", () => ({
  getVunaMethod: (...args: unknown[]) => mockGetVunaMethod(...args),
  validateFrappeSession: (...args: unknown[]) =>
    mockValidateFrappeSession(...args),
}));
jest.mock("@/sync/realtimeInvalidation", () => ({
  recoverPosResources: (...args: unknown[]) => mockRecoverPosResources(...args),
}));
jest.mock("@/hooks/usePosCachedResource", () => ({
  POS_CACHE_TTL_MS: 60_000,
  refreshRegisteredPosResources: (...args: unknown[]) =>
    mockRefreshRegisteredPosResources(...args),
}));

import { usePosRefreshTriggers } from "@/sync/usePosRefreshTriggers";
import { getServerReachabilityDiagnostics, resetServerReachability } from "@/sync/serverReachability";

describe("usePosRefreshTriggers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetServerReachability();
    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://pos.example.com",
      invalidateSession: mockInvalidateSession,
      sessionId: "sid-1",
    });
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    mockGetVunaMethod.mockResolvedValue({});
    mockValidateFrappeSession.mockResolvedValue("valid");
    mockRecoverPosResources.mockResolvedValue(undefined);
    mockInvalidateSession.mockResolvedValue(undefined);
    appStateCallback = undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(
      (_event, callback) => {
        appStateCallback = callback as typeof appStateCallback;
        return { remove: mockListener } as never;
      },
    );
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await cleanup();
  });

  it("probes the server and repairs the bootstrap after connectivity returns", async () => {
    const hook = await renderHook(() => usePosRefreshTriggers());
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    await hook.rerender(undefined);

    await waitFor(() => expect(mockValidateFrappeSession).toHaveBeenCalled());
    expect(mockValidateFrappeSession).toHaveBeenCalledWith(
      "https://pos.example.com",
      "sid-1",
    );
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(mockRecoverPosResources).toHaveBeenCalledWith("reconnect");
  });

  it("keeps a foreground refresh targeted to the timestamp delta", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    await renderHook(() => usePosRefreshTriggers());
    appStateCallback?.("background");
    appStateCallback?.("active");

    await waitFor(() => expect(mockValidateFrappeSession).toHaveBeenCalled());
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(mockRecoverPosResources).toHaveBeenCalledWith("foreground");
  });

  it("runs the app-level resource scheduler at the 60-second boundary", async () => {
    jest.useFakeTimers();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    await renderHook(() => usePosRefreshTriggers());

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockRefreshRegisteredPosResources).toHaveBeenCalledTimes(1);
  });

  it("repairs resources once when Frappe recovers while device connectivity stays online", async () => {
    jest.useFakeTimers();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockValidateFrappeSession
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValueOnce("unavailable")
      .mockResolvedValue("valid");
    await renderHook(() => usePosRefreshTriggers());
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(getServerReachabilityDiagnostics().status).toBe("unreachable");
    expect(mockRecoverPosResources).not.toHaveBeenCalled();

    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockRecoverPosResources).toHaveBeenCalledTimes(1);
    expect(mockRecoverPosResources).toHaveBeenCalledWith("reconnect");

    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });
    expect(mockRecoverPosResources).toHaveBeenCalledTimes(1);
  });

  it("invalidates a confirmed expired session found by the periodic probe, not an outage", async () => {
    jest.useFakeTimers();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockValidateFrappeSession.mockResolvedValue("expired");
    await renderHook(() => usePosRefreshTriggers());
    await act(async () => { await jest.advanceTimersByTimeAsync(30_000); });

    expect(mockInvalidateSession).toHaveBeenCalledTimes(1);
    expect(mockRecoverPosResources).not.toHaveBeenCalled();
  });

  it("ignores a late expiry result from a superseded login", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    let resolveOldProbe: (status: "expired") => void = () => undefined;
    mockValidateFrappeSession
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldProbe = resolve; }))
      .mockResolvedValue("valid");
    const hook = await renderHook(() => usePosRefreshTriggers());
    await waitFor(() => expect(mockValidateFrappeSession).toHaveBeenCalledWith("https://pos.example.com", "sid-1"));

    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://pos.example.com",
      invalidateSession: mockInvalidateSession,
      sessionId: "sid-2",
    });
    await hook.rerender(undefined);
    await waitFor(() => expect(mockValidateFrappeSession).toHaveBeenCalledWith("https://pos.example.com", "sid-2"));
    await act(async () => resolveOldProbe("expired"));

    expect(mockInvalidateSession).not.toHaveBeenCalled();
    expect(getServerReachabilityDiagnostics().status).toBe("reachable");
  });
});
