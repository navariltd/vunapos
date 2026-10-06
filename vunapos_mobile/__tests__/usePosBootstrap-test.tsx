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
  registerRealtimeControlRefresh: (resource: unknown, callback: unknown) =>
    mockRegisterRealtimeRefresh(resource, callback),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  usePosBootstrap,
  usePosBootstrapConfig,
} from "@/features/pos/hooks/usePosBootstrap";
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

  it("shares one authoritative snapshot between shell and catalogue consumers", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [{ item_code: "ITEM-001", item_name: "Item" }],
      payment_modes: [{ mode_of_payment: "Cash", default: true }],
      pos_profile: { currency: "KES", name: "POS-001" },
      pos_session: { ready: true },
      tax_settings: { add_taxes_from_item_tax_template: true },
    });

    const hook = await renderHook(() => usePosBootstrapConfig());

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
  });

  it("deduplicates shell and catalogue consumers on the shared cache key", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [],
      payment_modes: [],
      pos_profile: { name: "POS-001" },
    });

    const hook = await renderHook(() => ({
      config: usePosBootstrapConfig(),
      catalogue: usePosBootstrap(),
    }));

    await waitFor(() =>
      expect(hook.result.current.config.data?.pos_profile.name).toBe("POS-001"),
    );
    await waitFor(() => expect(hook.result.current.catalogue.data).not.toBeNull());
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(1);
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
      pos_profile: {
        currency: "KES",
        default_customer: {
          customer: "WALK-IN",
          customer_name: "Walk-in customer",
          default_price_list: "Standard Selling",
        },
        name: "POS-001",
      },
    });
    const hook = await renderHook(() => usePosBootstrap());

    await waitFor(() =>
      expect(hook.result.current.data?.pos_profile.name).toBe("POS-001"),
    );
    expect(hook.result.current.data?.items).toHaveLength(1);
    expect(hook.result.current.data?.default_customer).toEqual({
      customer: "WALK-IN",
      customer_name: "Walk-in customer",
      default_price_list: "Standard Selling",
    });
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
    const hook = await renderHook(() =>
      usePosBootstrap({ subscribeRealtime: true }),
    );
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());

    const refresh = mockRegisterRealtimeRefresh.mock.calls.at(-1)?.[1] as
      (() => Promise<void>) | undefined;
    expect(refresh).toBeDefined();
    await act(async () => refresh?.());

    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(2));
  });

  it("does not let feature bootstrap hooks own realtime subscriptions", async () => {
    mockGetVunaMethod.mockResolvedValue({
      items: [],
      payment_modes: [],
      pos_profile: { name: "POS-001" },
    });
    await renderHook(() => ({
      config: usePosBootstrapConfig(),
      catalogue: usePosBootstrap(),
    }));
    await waitFor(() => expect(mockGetVunaMethod).toHaveBeenCalledTimes(1));

    const handlers = mockRegisterRealtimeRefresh.mock.calls
      .filter(([resource]) => resource === "workspace-configuration")
      .map(([, callback]) => callback as () => Promise<void>);
    expect(handlers).toHaveLength(0);
  });

  it("maps the profile default customer from a cached server payload", async () => {
    await posCache.write(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      {
        items: [],
        payment_modes: [],
        pos_profile: {
          default_customer: {
            customer: "WALK-IN",
            customer_name: "Walk-in customer",
          },
          name: "POS-001",
        },
      },
      60 * 60 * 1000,
    );

    const hook = await renderHook(() => usePosBootstrap());

    await waitFor(() =>
      expect(hook.result.current.data?.default_customer).toEqual({
        customer: "WALK-IN",
        customer_name: "Walk-in customer",
      }),
    );
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
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

  it("requests a timestamp delta and merges changed and deleted rows into the cached snapshot", async () => {
    await posCache.write(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      {
        server_time: "2026-09-26 09:00:00",
        bootstrap_version: 6,
        mode: "full",
        items: [
          { item_code: "OLD-001", item_name: "Old item", actual_qty: 4 },
          { item_code: "CHANGED-001", item_name: "Changed item", actual_qty: 10 },
        ],
        customers: [
          { customer: "CUST-OLD", customer_name: "Old customer" },
        ],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      },
      1,
    );
    await posCache.markResourceStale(
      {
        companyUrl: "https://vuna.example.com",
        posProfile: "workspace",
        userId: "sid-1",
      },
      "workspace-configuration",
    );
    mockGetVunaMethod.mockResolvedValue({
      server_time: "2026-09-26 09:01:00",
      bootstrap_version: 6,
      mode: "delta",
      items: [
        { item_code: "CHANGED-001", item_name: "Changed item", actual_qty: 7 },
        { item_code: "NEW-001", item_name: "New item", actual_qty: 2 },
      ],
      customers: [],
      deleted: { Item: ["OLD-001"], Customer: ["CUST-OLD"] },
      payment_modes: [{ mode_of_payment: "Cash", default: true }],
      pos_profile: { name: "POS-001" },
    });

    const hook = await renderHook(() => usePosBootstrap());
    await waitFor(() =>
      expect(hook.result.current.data?.items?.map((item) => item.item_code)).toEqual([
        "CHANGED-001",
        "NEW-001",
      ]),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos.get_pos_bootstrap",
      { pos_profile: "POS-001", since: "2026-09-26 09:00:00" },
      expect.any(AbortSignal),
    );
    expect(hook.result.current.data?.items?.find((item) => item.item_code === "CHANGED-001")?.actual_qty).toBe(7);
    expect(hook.result.current.data?.customers).toEqual([]);
    expect(hook.result.current.data?.payment_modes).toEqual([
      { mode_of_payment: "Cash", default: true },
    ]);
    expect(hook.result.current.data?.lastFullSync).toBe(
      "2026-09-26 09:00:00",
    );
    expect(hook.result.current.data?.lastDeltaSync).toBe(
      "2026-09-26 09:01:00",
    );
  });

  it("falls back to a full snapshot when the bootstrap version changes", async () => {
    await posCache.write(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      {
        server_time: "2026-09-26 09:00:00",
        bootstrap_version: 6,
        mode: "full",
        items: [{ item_code: "STALE-001", item_name: "Stale item" }],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      },
      1,
    );
    await posCache.markResourceStale(
      {
        companyUrl: "https://vuna.example.com",
        posProfile: "workspace",
        userId: "sid-1",
      },
      "workspace-configuration",
    );
    mockGetVunaMethod
      .mockResolvedValueOnce({
        server_time: "2026-09-26 09:01:00",
        bootstrap_version: 7,
        mode: "delta",
        items: [{ item_code: "DELTA-001", item_name: "Delta item" }],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      })
      .mockResolvedValueOnce({
        server_time: "2026-09-26 09:02:00",
        bootstrap_version: 7,
        mode: "full",
        items: [{ item_code: "FRESH-001", item_name: "Fresh item" }],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      });

    const hook = await renderHook(() => usePosBootstrap());
    await waitFor(() =>
      expect(hook.result.current.data?.items?.[0]?.item_code).toBe("FRESH-001"),
    );
    expect(mockGetVunaMethod).toHaveBeenNthCalledWith(
      1,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos.get_pos_bootstrap",
      { pos_profile: "POS-001", since: "2026-09-26 09:00:00" },
      expect.any(AbortSignal),
    );
    expect(mockGetVunaMethod).toHaveBeenNthCalledWith(
      2,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos.get_pos_bootstrap",
      { pos_profile: "POS-001" },
      expect.any(AbortSignal),
    );
  });

  it("keeps the cached catalogue when the server returns an empty delta", async () => {
    await posCache.write(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      {
        server_time: "2026-09-26 09:00:00",
        bootstrap_version: 6,
        mode: "full",
        items: [{ item_code: "KEEP-001", item_name: "Keep me", actual_qty: 5 }],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      },
      1,
    );
    await posCache.markResourceStale(
      {
        companyUrl: "https://vuna.example.com",
        posProfile: "workspace",
        userId: "sid-1",
      },
      "workspace-configuration",
    );
    mockGetVunaMethod.mockResolvedValue({
      server_time: "2026-09-26 09:01:00",
      bootstrap_version: 6,
      mode: "delta",
      items: [],
      customers: [],
      deleted: { Item: [], Customer: [] },
      payment_modes: [],
      pos_profile: { name: "POS-001" },
    });

    const hook = await renderHook(() => usePosBootstrap());
    await waitFor(() =>
      expect(hook.result.current.data?.items?.[0]?.item_code).toBe("KEEP-001"),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.pos.get_pos_bootstrap",
      { pos_profile: "POS-001", since: "2026-09-26 09:00:00" },
      expect.any(AbortSignal),
    );
  });

  it("rejects malformed refresh payloads without replacing the cached snapshot", async () => {
    await posCache.write(
      {
        resource: "workspace-configuration",
        scope: {
          companyUrl: "https://vuna.example.com",
          posProfile: "workspace",
          userId: "sid-1",
        },
      },
      {
        server_time: "2026-09-26 09:00:00",
        bootstrap_version: 6,
        mode: "full",
        items: [{ item_code: "KEEP-001", item_name: "Keep me" }],
        payment_modes: [],
        pos_profile: { name: "POS-001" },
      },
      1,
    );
    await posCache.markResourceStale(
      {
        companyUrl: "https://vuna.example.com",
        posProfile: "workspace",
        userId: "sid-1",
      },
      "workspace-configuration",
    );
    mockGetVunaMethod.mockResolvedValue(null);

    const hook = await renderHook(() => usePosBootstrap());
    await waitFor(() =>
      expect(hook.result.current.error).toBe(
        "The POS bootstrap response was empty or malformed.",
      ),
    );
    expect(hook.result.current.data?.items?.[0]?.item_code).toBe("KEEP-001");
  });
});
