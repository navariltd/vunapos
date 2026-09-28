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

const mockInvalidateCustomerPaymentCache = jest.fn();
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateCustomerPaymentCache: (...args: unknown[]) =>
    mockInvalidateCustomerPaymentCache(...args),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosPaymentReconciliation } from "@/features/pos/hooks/usePosPaymentReconciliation";
import { postVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockPostVunaMethod = jest.mocked(postVunaMethod);

describe("usePosPaymentReconciliation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateCustomerPaymentCache.mockResolvedValue(undefined);
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

  it("submits only the reviewed entries for server-side reconciliation", async () => {
    const result = { allocated_amount: 58, allocations: [] };
    mockPostVunaMethod.mockResolvedValue(result);
    const hook = await renderHook(() => usePosPaymentReconciliation());
    let response: Awaited<ReturnType<typeof hook.result.current.reconcile>> =
      null;

    await act(async () => {
      response = await hook.result.current.reconcile({
        customer: "CUST-001",
        invoices: ["SINV-0001"],
        paymentEntries: ["ACC-PAY-0001"],
        posProfile: "POS-001",
      });
    });

    expect(response).toEqual(result);
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.payment.reconcile_customer_payment",
      {
        customer: "CUST-001",
        invoices: '["SINV-0001"]',
        payment_entries: '["ACC-PAY-0001"]',
        pos_profile: "POS-001",
      },
    );
    expect(mockInvalidateCustomerPaymentCache).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });
  });

  it("attempts reconciliation while offline", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const hook = await renderHook(() => usePosPaymentReconciliation());

    await act(async () => {
      await hook.result.current.reconcile({
        customer: "CUST-001",
        invoices: ["SINV-0001"],
        paymentEntries: ["ACC-PAY-0001"],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalled();
  });

  it("does not submit a second reconciliation while the first is pending", async () => {
    let resolveRequest!: (value: { allocated_amount: number; allocations: never[] }) => void;
    mockPostVunaMethod.mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const hook = await renderHook(() => usePosPaymentReconciliation());
    const input = {
      customer: "CUST-001",
      invoices: ["SINV-0001"],
      paymentEntries: ["ACC-PAY-0001"],
      posProfile: "POS-001",
    };

    let first!: Promise<unknown>;
    await act(async () => {
      first = hook.result.current.reconcile(input);
      await Promise.resolve();
      expect(await hook.result.current.reconcile(input)).toBeNull();
    });
    resolveRequest({ allocated_amount: 58, allocations: [] });
    await act(async () => {
      await first;
    });

    expect(mockPostVunaMethod).toHaveBeenCalledTimes(1);
  });
});
