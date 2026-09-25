import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

const mockUseAppSession = jest.fn();
const mockUseNetworkStatus = jest.fn();

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => mockUseAppSession(),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/sync/frappeRealtimeClient", () => ({
  frappeRealtimeClient: { start: jest.fn(), stop: jest.fn() },
}));

import { frappeRealtimeClient } from "@/sync/frappeRealtimeClient";
import { useFrappeRealtime } from "@/sync/useFrappeRealtime";

const mockStart = jest.mocked(frappeRealtimeClient.start);
const mockStop = jest.mocked(frappeRealtimeClient.stop);

describe("useFrappeRealtime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://pos.example.com",
      sessionId: "sid-1",
    });
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
  });

  it("starts one client for the signed-in online app session and stops on cleanup", async () => {
    renderHook(() => useFrappeRealtime());

    await waitFor(() =>
      expect(mockStart).toHaveBeenCalledWith(
        "https://pos.example.com",
        "sid-1",
      ),
    );
    await cleanup();
    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1));
  });

  it("does not connect while offline or signed out", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    renderHook(() => useFrappeRealtime());
    expect(mockStart).not.toHaveBeenCalled();
    await waitFor(() => expect(mockStop).toHaveBeenCalledTimes(1));
  });
});
