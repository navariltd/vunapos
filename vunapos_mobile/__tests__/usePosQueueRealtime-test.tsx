import { act, cleanup, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

const mockRegister = jest.fn();
jest.mock("@/sync/realtimeInvalidation", () => ({
  registerRealtimeRefresh: (resource: unknown, callback: unknown) =>
    mockRegister(resource, callback),
}));

const mockTake = jest.fn();
jest.mock("@/sync/queuedCheckoutRegistry", () => ({
  clearQueuedCheckouts: jest.fn(),
  takeQueuedCheckout: (...args: unknown[]) => mockTake(...args),
}));

const mockInvalidateHeld = jest.fn();
const mockInvalidateSale = jest.fn();
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateHeldInvoiceCache: (...args: unknown[]) => mockInvalidateHeld(...args),
  invalidateSaleCache: (...args: unknown[]) => mockInvalidateSale(...args),
}));

const mockRefreshStock = jest.fn();
jest.mock("@/services/posInventoryRefresh", () => ({
  refreshSoldItemStock: (...args: unknown[]) => mockRefreshStock(...args),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosQueueRealtime } from "@/sync/usePosQueueRealtime";

const mockUseAppSession = jest.mocked(useAppSession);

describe("usePosQueueRealtime", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppSession.mockReturnValue({
      authState: "signedIn",
      companyUrl: "https://vuna.example.com",
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("refreshes only the queued sale's stock after a submitted transition", async () => {
    const items = [{ item_code: "ITEM-A", qty: 2 }];
    mockTake.mockReturnValue({
      customer: "Customer A",
      items,
      posProfile: "POS-1",
      priceList: "Standard Selling",
    });
    mockInvalidateHeld.mockResolvedValue(undefined);
    mockInvalidateSale.mockResolvedValue(undefined);
    mockRefreshStock.mockResolvedValue(undefined);

    renderHook(() => usePosQueueRealtime());
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    const handler = mockRegister.mock.calls[0][1] as (payload: unknown) => Promise<void>;
    await act(async () => {
      await handler({
        invoice_name: "SINV-QUEUE-001",
        pos_profile: "POS-1",
        status: "Submitted",
      });
    });

    expect(mockTake).toHaveBeenCalledWith("https://vuna.example.com", "sid-1", "SINV-QUEUE-001");
    expect(mockInvalidateHeld).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-1",
      sessionId: "sid-1",
    });
    expect(mockInvalidateSale).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-1",
      sessionId: "sid-1",
    });
    expect(mockRefreshStock).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      items,
      posProfile: "POS-1",
      sessionId: "sid-1",
    });
  });

  it("does not refresh stock for failed queue work, but refreshes queue lists", async () => {
    mockTake.mockReturnValue({
      items: [{ item_code: "ITEM-A", qty: 2 }],
      posProfile: "POS-1",
    });
    mockInvalidateHeld.mockResolvedValue(undefined);

    renderHook(() => usePosQueueRealtime());
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    const handler = mockRegister.mock.calls[0][1] as (payload: unknown) => Promise<void>;
    await act(async () => {
      await handler({
        invoice_name: "SINV-QUEUE-002",
        pos_profile: "POS-1",
        status: "Failed",
      });
    });

    expect(mockInvalidateHeld).toHaveBeenCalled();
    expect(mockInvalidateSale).not.toHaveBeenCalled();
    expect(mockRefreshStock).not.toHaveBeenCalled();
  });

  it("stops an old session's queued refresh after a new session takes ownership", async () => {
    mockTake.mockReturnValue({ items: [{ item_code: "ITEM-A", qty: 1 }], posProfile: "POS-1" });
    let finishInvalidation!: () => void;
    mockInvalidateHeld.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishInvalidation = resolve;
    }));
    const hook = await renderHook(() => usePosQueueRealtime());
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    const oldHandler = mockRegister.mock.calls[0][1] as (payload: unknown) => Promise<void>;
    let pending!: Promise<void>;
    await act(async () => {
      pending = oldHandler({ invoice_name: "QUEUE-1", pos_profile: "POS-1", status: "Submitted" });
      await Promise.resolve();
    });

    mockUseAppSession.mockReturnValue({
      authState: "signedIn", companyUrl: "https://other.example.com", sessionId: "sid-2",
    } as unknown as ReturnType<typeof useAppSession>);
    await hook.rerender(undefined);
    await act(async () => { finishInvalidation(); await pending; });

    expect(mockInvalidateSale).not.toHaveBeenCalled();
    expect(mockRefreshStock).not.toHaveBeenCalled();
  });

  it("marks a submitted queue sale stale when its cart context was lost", async () => {
    mockTake.mockReturnValue(undefined);
    mockInvalidateHeld.mockResolvedValue(undefined);
    mockInvalidateSale.mockResolvedValue(undefined);

    renderHook(() => usePosQueueRealtime());
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    const handler = mockRegister.mock.calls[0][1] as (payload: unknown) => Promise<void>;
    await act(async () => {
      await handler({
        invoice_name: "SINV-RESTARTED-001",
        pos_profile: "POS-1",
        status: "Submitted",
      });
    });

    expect(mockInvalidateSale).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-1",
      sessionId: "sid-1",
    });
    expect(mockRefreshStock).not.toHaveBeenCalled();
  });
});
