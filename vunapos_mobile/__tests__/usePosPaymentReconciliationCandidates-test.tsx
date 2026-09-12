import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

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
import { usePosPaymentReconciliationCandidates } from "@/features/pos/hooks/usePosPaymentReconciliationCandidates";
import { getVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const invalidateSession = jest.fn();

describe("usePosPaymentReconciliationCandidates", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads only reconciliation candidates available to the active POS profile", async () => {
    const candidates = {
      invoices: [
        {
          amount: 116,
          currency: "KES",
          name: "SINV-0001",
          outstanding_amount: 58,
          posting_date: "2026-09-12",
        },
      ],
      payments: [
        {
          amount: 58,
          currency: "KES",
          name: "ACC-PAY-0001",
          posting_date: "2026-09-11",
        },
      ],
    };
    mockGetVunaMethod.mockResolvedValue(candidates);

    const hook = await renderHook(() =>
      usePosPaymentReconciliationCandidates("CUST-001", "POS-001"),
    );

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.payment.get_reconciliation_candidates",
        { customer: "CUST-001", pos_profile: "POS-001" },
        expect.any(AbortSignal),
      ),
    );
    await waitFor(() =>
      expect(hook.result.current).toEqual({
        data: candidates,
        error: null,
        isLoading: false,
      }),
    );
  });

  it("does not fetch before a customer and POS profile are available or while offline", async () => {
    const missingContext = await renderHook(() =>
      usePosPaymentReconciliationCandidates("", undefined),
    );

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(missingContext.result.current).toEqual({
      data: null,
      error: null,
      isLoading: false,
    });

    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const offline = await renderHook(() =>
      usePosPaymentReconciliationCandidates("CUST-001", "POS-001"),
    );

    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(offline.result.current.isLoading).toBe(false);
  });
});
