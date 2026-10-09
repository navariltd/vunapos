import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosInvoiceDetails } from "@/features/pos/hooks/usePosInvoiceDetails";
import { FrappeClientError, getVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);

describe("usePosInvoiceDetails", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession: jest.fn(),
      sessionId: "sid-1",
    } as never);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("retains only same-invoice details after a recoverable refresh failure", async () => {
    const invoice = { name: "SINV-001", customer: "CUST-001" };
    mockGetVunaMethod.mockResolvedValueOnce(invoice);
    const hook = await renderHook<ReturnType<typeof usePosInvoiceDetails>, { invoiceName: string }>(
      ({ invoiceName }) => usePosInvoiceDetails({ invoiceName, posProfile: "POS-001" }),
      { initialProps: { invoiceName: "SINV-001" } },
    );
    await waitFor(() => expect(hook.result.current.data).toMatchObject(invoice));

    mockGetVunaMethod.mockRejectedValueOnce(Object.assign(
      new FrappeClientError("Connection interrupted", "connection"),
      { code: "connection" },
    ));
    await act(async () => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.error).toBe("Connection interrupted"));
    expect(hook.result.current.data).toMatchObject(invoice);
    expect(hook.result.current.isRecoverableError).toBe(true);

    mockGetVunaMethod.mockRejectedValueOnce(Object.assign(
      new FrappeClientError("Invoice access denied", "api"),
      { code: "api" },
    ));
    await hook.rerender({ invoiceName: "SINV-002" });
    await waitFor(() => expect(hook.result.current.error).toBe("Invoice access denied"));
    expect(hook.result.current.data).toBeNull();
    expect(hook.result.current.isRecoverableError).toBe(false);
  });
});
