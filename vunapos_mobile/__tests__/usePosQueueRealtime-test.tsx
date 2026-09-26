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
  takeQueuedCheckout: (name: string) => mockTake(name),
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

    expect(mockTake).toHaveBeenCalledWith("SINV-QUEUE-001");
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
      customer: "Customer A",
      items,
      posProfile: "POS-1",
      priceList: "Standard Selling",
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
});
