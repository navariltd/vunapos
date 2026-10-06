import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";

const mockUseAppSession = jest.fn();
const mockUseNetworkStatus = jest.fn();
const mockGetVunaMethod = jest.fn();
const mockValidateFrappeSession = jest.fn();
const mockInvalidateRealtimeResource = jest.fn();
const mockRefreshRegisteredPosResources = jest.fn();
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
  invalidateRealtimeResource: (...args: unknown[]) =>
    mockInvalidateRealtimeResource(...args),
}));
jest.mock("@/hooks/usePosCachedResource", () => ({
  POS_CACHE_TTL_MS: 60_000,
  refreshRegisteredPosResources: (...args: unknown[]) =>
    mockRefreshRegisteredPosResources(...args),
}));

import { usePosRefreshTriggers } from "@/sync/usePosRefreshTriggers";

describe("usePosRefreshTriggers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
    });
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    mockGetVunaMethod.mockResolvedValue({});
    mockValidateFrappeSession.mockResolvedValue("valid");
    mockInvalidateRealtimeResource.mockResolvedValue(undefined);
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
    expect(mockInvalidateRealtimeResource).toHaveBeenCalledWith(
      "referenceDataChanged",
      { full: false, source: "reconnect" },
    );
  });

  it("keeps a foreground refresh targeted to the timestamp delta", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    await renderHook(() => usePosRefreshTriggers());
    appStateCallback?.("background");
    appStateCallback?.("active");

    await waitFor(() => expect(mockValidateFrappeSession).toHaveBeenCalled());
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(mockInvalidateRealtimeResource).toHaveBeenCalledWith(
      "referenceDataChanged",
      { full: false, source: "foreground" },
    );
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
});
