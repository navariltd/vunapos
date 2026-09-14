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
import { usePosCustomerSearch } from "@/features/pos/hooks/usePosCustomerSearch";
import { getVunaMethod } from "@/services/frappeClient";
import { posCache } from "@/services/posCache";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const invalidateSession = jest.fn();

describe("usePosCustomerSearch", () => {
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
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => cleanup());

  it("searches permitted Frappe customers and maps them for a POS sale", async () => {
    mockGetVunaMethod.mockResolvedValue([
      {
        customer: "CUST-001",
        customer_name: "Acme Stores",
        is_walkin: true,
        mobile_no: "+254700000000",
        tax_id: "P012345678X",
      },
    ]);
    const hook = await renderHook(() =>
      usePosCustomerSearch("acme", true, "POS-001"),
    );

    await waitFor(() =>
      expect(hook.result.current.rows).toEqual([
        {
          customer: "CUST-001",
          customerName: "Acme Stores",
          email: undefined,
          isWalkin: true,
          mobile: "+254700000000",
          taxId: "P012345678X",
        },
      ]),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.customer.search_customers",
      { limit: 20, query: "acme" },
      expect.any(AbortSignal),
    );
  });

  it("shows a saved customer lookup offline and refreshes it on demand", async () => {
    mockGetVunaMethod.mockResolvedValue([]);
    const hook = await renderHook(() =>
      usePosCustomerSearch("acme", true, "POS-001"),
    );

    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    await hook.rerender(undefined);
    expect(hook.result.current.rows).toEqual([]);
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(1);

    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    const refreshedHook = await renderHook(() =>
      usePosCustomerSearch("acme", true, "POS-001"),
    );
    await waitFor(() => expect(refreshedHook.result.current.isLoading).toBe(false));
    await act(async () => {
      await refreshedHook.result.current.reload();
    });
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(2);
  });
});
