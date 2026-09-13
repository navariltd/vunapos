import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCustomerDirectory } from "@/features/pos/hooks/usePosCustomerDirectory";
import { getVunaMethod } from "@/services/frappeClient";

const invalidateSession = jest.fn();
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);

describe("usePosCustomerDirectory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => cleanup());

  it("loads the first permission-filtered server page for the active POS Profile", async () => {
    mockGetVunaMethod.mockResolvedValue({
      as_of: "2026-09-13 09:00:00",
      customer_groups: [],
      customers: [],
      financials_visible: true,
      limit: 25,
      loyalty_visible: true,
      start: 0,
      territories: [],
      total_count: 0,
    });
    const hook = await renderHook(() => usePosCustomerDirectory("POS-001"));

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.customer.get_customer_directory",
        { limit: 25, pos_profile: "POS-001", query: "", start: 0 },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() => expect(hook.result.current.data?.limit).toBe(25));
  });

  it("does not request the directory before a POS Profile is available or while offline", async () => {
    const missingProfile = await renderHook(() =>
      usePosCustomerDirectory(undefined),
    );
    expect(missingProfile.result.current.isLoading).toBe(false);
    expect(mockGetVunaMethod).not.toHaveBeenCalled();

    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const offline = await renderHook(() => usePosCustomerDirectory("POS-001"));
    expect(offline.result.current.isLoading).toBe(false);
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
  });

  it("debounces the server query instead of requesting on every keystroke", async () => {
    jest.useFakeTimers();
    mockGetVunaMethod.mockResolvedValue({
      as_of: "2026-09-13 09:00:00",
      customer_groups: [],
      customers: [],
      financials_visible: true,
      limit: 25,
      loyalty_visible: true,
      start: 0,
      territories: [],
      total_count: 0,
    });
    try {
      const hook = await renderHook<
        ReturnType<typeof usePosCustomerDirectory>,
        { query: string }
      >(({ query }) => usePosCustomerDirectory("POS-001", query), {
        initialProps: { query: "" },
      });
      await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(1));
      mockGetVunaMethod.mockClear();

      await hook.rerender({ query: "A" });
      await hook.rerender({ query: "AB" });
      await hook.rerender({ query: "ABC" });
      expect(mockGetVunaMethod).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(299);
      });
      expect(mockGetVunaMethod).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.customer.get_customer_directory",
        { limit: 25, pos_profile: "POS-001", query: "ABC", start: 0 },
        expect.any(AbortSignal),
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
