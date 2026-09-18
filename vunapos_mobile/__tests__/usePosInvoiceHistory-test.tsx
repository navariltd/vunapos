import { cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {
    code: string;

    constructor(message: string, mockCode: string) {
      super(message);
      this.code = mockCode;
    }
  },
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosInvoiceHistory } from "@/features/pos/hooks/usePosInvoiceHistory";
import { PosInvoiceHistoryFilters } from "@/features/pos/types";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";
import { posCache } from "@/services/posCache";

const filters = {
  currentShift: false,
  customer: "  CUST-001  ",
  documentType: "Order" as const,
  fromDate: "2026-09-01",
  invoice: "  SO-0001 ",
  paymentMode: "Bank",
  saleType: "Credit Sale",
  status: "Unpaid",
  toDate: "2026-09-12",
} satisfies PosInvoiceHistoryFilters;

describe("usePosInvoiceHistory", () => {
  const invalidateSession = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    await posCache.clearNamespace({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      userId: "sid-1",
    });
    jest.mocked(useAppSession).mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("sends every filter and page offset to the profile-scoped history endpoint", async () => {
    jest
      .mocked(getVunaMethod)
      .mockResolvedValue({ invoices: [], summary: { invoice_count: 0 } });

    const hook = await renderHook(() =>
      usePosInvoiceHistory({ filters, posProfile: "POS-001", start: 25 }),
    );

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    expect(getVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.get_invoice_history",
      {
        current_shift: 0,
        customer: "CUST-001",
        document_type: "Order",
        from_date: "2026-09-01",
        invoice: "SO-0001",
        page_length: 25,
        payment_mode: "Bank",
        pos_profile: "POS-001",
        sale_type: "Credit Sale",
        start: 25,
        status: "Unpaid",
        to_date: "2026-09-12",
      },
      expect.any(AbortSignal),
    );
  });

  it("does not request history until an authenticated profile is available", async () => {
    jest.mocked(useAppSession).mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: null,
    } as unknown as ReturnType<typeof useAppSession>);

    const hook = await renderHook(() =>
      usePosInvoiceHistory({ filters, posProfile: undefined, start: 0 }),
    );

    expect(hook.result.current).toMatchObject({
      data: null,
      error: null,
      isLoading: false,
    });
    expect(getVunaMethod).not.toHaveBeenCalled();
  });

  it("invalidates an expired session without presenting stale history as an error", async () => {
    const sessionError = new FrappeClientError("Session expired", "session");
    jest.mocked(getVunaMethod).mockRejectedValue(sessionError);

    const hook = await renderHook(() =>
      usePosInvoiceHistory({ filters, posProfile: "POS-001", start: 0 }),
    );

    await waitFor(() => expect(invalidateSession).toHaveBeenCalledTimes(1));
    expect(hook.result.current.error).toBeNull();
  });
});
