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
import { usePosPaymentHistory } from "@/features/pos/hooks/usePosPaymentHistory";
import { getVunaMethod } from "@/services/frappeClient";
import { posCache } from "@/services/posCache";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);

describe("usePosPaymentHistory", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await posCache.clearNamespace({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    });
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession: jest.fn(),
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads VunaPOS Payment Entries for the active POS profile", async () => {
    mockGetVunaMethod.mockResolvedValue({ payments: [] });
    const hook = await renderHook(() => usePosPaymentHistory("POS-001"));

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.payment.get_payment_history",
        { pos_profile: "POS-001" },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(hook.result.current).toMatchObject({
        data: { payments: [] },
        error: null,
        isLoading: false,
      }),
    );
  });

  it("does not request payment history while offline", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const hook = await renderHook(() => usePosPaymentHistory("POS-001"));

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.isLoading).toBe(false);
  });

  it("refreshes payment history even while its saved result is still fresh", async () => {
    mockGetVunaMethod.mockResolvedValue({ payments: [] });
    const hook = await renderHook(() => usePosPaymentHistory("POS-001"));

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    await act(async () => {
      await hook.result.current.reload();
    });

    expect(mockGetVunaMethod).toHaveBeenCalledTimes(2);
  });

  it("sends customer and inclusive date-range filters to the history endpoint", async () => {
    mockGetVunaMethod.mockResolvedValue({ payments: [] });
    const hook = await renderHook(() =>
      usePosPaymentHistory("POS-001", {
        cashier: "cashier@example.com",
        customer: "CUST-001",
        fromDate: "2026-09-01",
        modeOfPayment: "Cash",
        reference: "TXN-001",
        status: "Submitted",
        toDate: "2026-09-12",
      }),
    );

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.payment.get_payment_history",
        {
          cashier: "cashier@example.com",
          customer: "CUST-001",
          from_date: "2026-09-01",
          mode_of_payment: "Cash",
          pos_profile: "POS-001",
          reference: "TXN-001",
          status: "Submitted",
          to_date: "2026-09-12",
        },
        expect.any(AbortSignal),
      ),
    );
  });
});
