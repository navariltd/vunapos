import { act, cleanup, renderHook } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  postVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosPaymentReconciliationAllocation } from "@/features/pos/hooks/usePosPaymentReconciliationAllocation";
import { postVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockPostVunaMethod = jest.mocked(postVunaMethod);

describe("usePosPaymentReconciliationAllocation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it("requests a non-mutating server allocation preview for the selected entries", async () => {
    const allocations = [
      {
        allocated_amount: 58,
        currency: "KES",
        invoice: "SINV-0001",
        payment_entry: "ACC-PAY-0001",
      },
    ];
    mockPostVunaMethod.mockResolvedValue({ allocations });
    const hook = await renderHook(() =>
      usePosPaymentReconciliationAllocation(),
    );
    let result: Awaited<ReturnType<typeof hook.result.current.allocate>> = null;

    await act(async () => {
      result = await hook.result.current.allocate({
        customer: "CUST-001",
        invoices: ["SINV-0001"],
        paymentEntries: ["ACC-PAY-0001"],
        posProfile: "POS-001",
      });
    });

    expect(result).toEqual(allocations);
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.payment.allocate_customer_payments",
      {
        customer: "CUST-001",
        invoices: '["SINV-0001"]',
        payment_entries: '["ACC-PAY-0001"]',
        pos_profile: "POS-001",
      },
    );
  });

  it("does not request an allocation preview while offline", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const hook = await renderHook(() =>
      usePosPaymentReconciliationAllocation(),
    );

    await act(async () => {
      await hook.result.current.allocate({
        customer: "CUST-001",
        invoices: ["SINV-0001"],
        paymentEntries: ["ACC-PAY-0001"],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe(
      "Connection unavailable. Reconnect before allocating payments.",
    );
  });
});
