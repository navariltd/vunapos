import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

const mockRegisterRealtimeRefresh = jest.fn(
  (_resource: unknown, _callback: unknown) => jest.fn(),
);
jest.mock("@/sync/realtimeInvalidation", () => ({
  registerRealtimeRefresh: (resource: unknown, callback: unknown) =>
    mockRegisterRealtimeRefresh(resource, callback),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { getVunaMethod } from "@/services/frappeClient";
import { posCache } from "@/services/posCache";

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();

describe("usePosBootstrap", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await posCache.clearNamespace({
      companyUrl: "https://vuna.example.com",
      posProfile: "workspace",
      userId: "sid-1",
    });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("loads the authenticated POS profile and initial catalogue, and supports a manual retry", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [
        {
          actual_qty: 3,
          item_code: "LIVE-001",
          item_name: "Live catalogue item",
          rate: 150,
        },
      ],
      payment_modes: [],
      pos_profile: { currency: "KES", name: "POS-001" },
    });
    const hook = await renderHook(() => usePosBootstrap());

    await waitFor(() =>
      expect(hook.result.current.data?.pos_profile.name).toBe("POS-001"),
    );
    expect(hook.result.current.data?.items).toHaveLength(1);
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos.get_pos_bootstrap",
      {},
      expect.any(AbortSignal),
    );

    await act(async () => hook.result.current.reload());
    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(2));
  });

  it("refreshes bootstrap data when desk-side POS configuration changes", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [],
      payment_modes: [],
      pos_profile: { name: "POS-001" },
    });
    const hook = await renderHook(() => usePosBootstrap());
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());

    const refresh = mockRegisterRealtimeRefresh.mock.calls.at(-1)?.[1] as
      (() => Promise<void>) | undefined;
    expect(refresh).toBeDefined();
    await act(async () => refresh?.());

    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(2));
  });

  it("keeps only complete, supported profile checkout-field definitions from bootstrap", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [],
      payment_modes: [],
      pos_profile: {
        checkout_fields: [
          {
            doctype: "Sales Invoice",
            fieldname: "custom_purchase_order",
            fieldtype: "Data",
            help_text: "Optional reference",
            label: "Purchase order",
            order: 2,
            placeholder: "PO-123",
            required: 1,
          },
          {
            doctype: "Customer",
            fieldname: "customer_name",
            fieldtype: "Data",
            label: "Invalid type",
          },
          {
            doctype: "Sales Order",
            fieldname: "",
            fieldtype: "Date",
            label: "Missing name",
          },
        ],
        name: "POS-001",
      },
    });

    const hook = await renderHook(() => usePosBootstrap());

    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    expect(hook.result.current.data?.pos_profile.checkout_fields).toEqual([
      {
        doctype: "Sales Invoice",
        fieldname: "custom_purchase_order",
        fieldtype: "Data",
        help_text: "Optional reference",
        label: "Purchase order",
        order: 2,
        placeholder: "PO-123",
        required: true,
      },
    ]);
  });
});
