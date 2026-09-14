import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

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
import {
  useReceiveCustomerPayment,
  useReceiveInvoicePayment,
} from "@/features/pos/hooks/useReceiveInvoicePayment";
import { postVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();

describe("useReceiveInvoicePayment", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateCustomerPaymentCache.mockResolvedValue(undefined);
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

  it("submits one invoice allocation with a retry-safe idempotency key", async () => {
    mockPostVunaMethod.mockResolvedValue({ name: "ACC-PAY-0001" });
    const hook = await renderHook(() => useReceiveInvoicePayment());
    let result:
      Awaited<ReturnType<typeof hook.result.current.receive>> | undefined;

    await act(async () => {
      result = await hook.result.current.receive({
        amount: 150,
        customer: "CUST-001",
        invoice: "SINV-0001",
        modeOfPayment: "Cash",
        posProfile: "POS-001",
      });
    });

    expect(result).toEqual({ name: "ACC-PAY-0001" });
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.payment.receive_customer_payment",
      {
        allocated_amount: 150,
        amount: 150,
        customer: "CUST-001",
        idempotency_key: expect.stringMatching(/^mobile-payment-/),
        mode_of_payment: "Cash",
        pos_profile: "POS-001",
        reference_date: undefined,
        reference_no: undefined,
        sales_invoice: "SINV-0001",
      },
    );
    expect(hook.result.current).toMatchObject({
      error: null,
      isSubmitting: false,
    });
    expect(mockInvalidateCustomerPaymentCache).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });
  });

  it("does not submit a customer payment while offline", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const hook = await renderHook(() => useReceiveInvoicePayment());

    await act(async () => {
      await hook.result.current.receive({
        amount: 150,
        customer: "CUST-001",
        invoice: "SINV-0001",
        modeOfPayment: "Cash",
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.error).toBe(
      "Connection unavailable. Reconnect before receiving a payment.",
    );
  });

  it("waits for confirmed reachability before submitting a customer payment", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "unknown" });
    const hook = await renderHook(() => useReceiveInvoicePayment());

    await act(async () => {
      await hook.result.current.receive({
        amount: 150,
        customer: "CUST-001",
        invoice: "SINV-0001",
        modeOfPayment: "Cash",
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).not.toHaveBeenCalled();
  });

  it("submits an unallocated customer advance without invoice-only fields", async () => {
    mockPostVunaMethod.mockResolvedValue({ name: "ACC-PAY-0002" });
    const hook = await renderHook(() => useReceiveCustomerPayment());

    await act(async () => {
      await hook.result.current.receive({
        amount: 75,
        customer: "CUST-001",
        modeOfPayment: "Cash",
        posProfile: "POS-001",
        remarks: "Advance for future order",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.payment.receive_customer_payment",
      expect.objectContaining({
        amount: 75,
        customer: "CUST-001",
        mode_of_payment: "Cash",
        remarks: "Advance for future order",
      }),
    );
    expect(mockPostVunaMethod.mock.calls[0][3]).not.toHaveProperty(
      "allocated_amount",
    );
    expect(mockPostVunaMethod.mock.calls[0][3]).not.toHaveProperty(
      "sales_invoice",
    );
  });

  it("shows request errors instead of claiming a payment was received", async () => {
    mockPostVunaMethod.mockRejectedValue(new Error("No active POS shift."));
    const hook = await renderHook(() => useReceiveInvoicePayment());

    await act(async () => {
      await hook.result.current.receive({
        amount: 150,
        customer: "CUST-001",
        invoice: "SINV-0001",
        modeOfPayment: "Cash",
        posProfile: "POS-001",
      });
    });

    await waitFor(() =>
      expect(hook.result.current.error).toBe("No active POS shift."),
    );
  });
});
