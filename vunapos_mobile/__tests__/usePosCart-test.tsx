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
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));

const mockInvalidateHeldInvoiceCache = jest.fn();
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateHeldInvoiceCache: (...args: unknown[]) =>
    mockInvalidateHeldInvoiceCache(...args),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import { usePosCart } from "@/features/pos/hooks/usePosCart";
import { PosSaleCustomer } from "@/features/pos/types";
import { getVunaMethod, postVunaMethod } from "@/services/frappeClient";

const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const mockUseAppSession = jest.mocked(useAppSession);
const invalidateSession = jest.fn();
const item = {
  actual_qty: 5,
  is_stock_item: true,
  item_code: "ITEM-001",
  item_name: "Stock item",
  rate: 125,
  stock_uom: "Nos",
};

describe("usePosCart", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateHeldInvoiceCache.mockResolvedValue(undefined);
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItems = String(params?.items ?? "");
        const isQuantityThree = cartItems.includes('"qty":3');
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: isQuantityThree ? 375 : 125,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              qty: isQuantityThree ? 3 : 1,
              rate: 125,
              uom: "Nos",
            },
          ],
          taxes: [
            { description: "VAT", tax_amount: isQuantityThree ? 60 : 20 },
          ],
          totals: {
            grand_total: isQuantityThree ? 435 : 145,
            net_total: isQuantityThree ? 375 : 125,
          },
        };
      },
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  it("adds catalogue items through Frappe and uses its calculated item and total values", async () => {
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });

    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      {
        customer: "CUST-001",
        items: '[{"item_code":"ITEM-001","qty":1,"uom":"Nos"}]',
        pos_profile: "POS-001",
      },
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({
        amount: 125,
        available_qty: 4,
        item_code: "ITEM-001",
        qty: 1,
      }),
    ]);
    expect(hook.result.current.subtotal).toBe(125);
    expect(hook.result.current.taxes).toEqual([
      { description: "VAT", tax_amount: 20 },
    ]);
  });

  it("keeps the current cart intact and makes no request when explicitly offline", async () => {
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );
    await act(async () => {
      await hook.result.current.add(item);
    });
    expect(hook.result.current.items).toHaveLength(1);
    const requestCount = mockGetVunaMethod.mock.calls.length;

    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    await hook.rerender(undefined);
    await act(async () => {
      await hook.result.current.updateQuantity("ITEM-001", 3);
    });
    let wasCleared: boolean | undefined;
    await act(async () => {
      wasCleared = hook.result.current.clear();
    });
    expect(wasCleared).toBe(false);
    await act(async () => {
      await hook.result.current.hold();
    });

    expect(hook.result.current.items).toHaveLength(1);
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(requestCount);
    expect(mockPostVunaMethod).not.toHaveBeenCalled();
  });

  it("keeps a temporary cart until a customer is selected, then refreshes it with Frappe", async () => {
    const hook = await renderHook<
      ReturnType<typeof usePosCart>,
      { customer: PosSaleCustomer | null }
    >(({ customer }) => usePosCart({ customer, posProfile: "POS-001" }), {
      initialProps: { customer: null },
    });

    await act(async () => hook.result.current.add(item));
    expect(mockGetVunaMethod).not.toHaveBeenCalled();
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ item_code: "ITEM-001", qty: 1 }),
    ]);
    expect(hook.result.current.subtotal).toBe(125);
    expect(hook.result.current.requiresCustomer).toBe(true);

    await hook.rerender({
      customer: { customer: "CUST-001", customerName: "Example customer" },
    });
    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.sales.preview_invoice",
        expect.objectContaining({ customer: "CUST-001" }),
      ),
    );
    expect(hook.result.current.requiresCustomer).toBe(false);

    await act(async () => hook.result.current.updateQuantity("ITEM-001", 3));
    expect(hook.result.current.subtotal).toBe(375);
    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items: '[{"item_code":"ITEM-001","qty":3,"uom":"Nos"}]',
      }),
    );

    await act(async () => hook.result.current.remove("ITEM-001"));
    expect(hook.result.current.items).toEqual([]);

    await act(async () => hook.result.current.add(item));
    await act(async () => hook.result.current.clear());
    expect(hook.result.current.items).toEqual([]);
  });

  it("uses the catalogue sales UOM and restores its price after clearing a customer", async () => {
    const salesUomItem = {
      actual_qty: 120,
      conversion_factor: 24,
      is_stock_item: true,
      item_code: "F61",
      item_name: "Dairy Joy 200ml",
      rate: 544,
      stock_uom: "Pcs",
      uom: "Carton",
    };
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const sentItems = String(params?.items ?? "");
        if (sentItems.includes('"item_code":"F61"')) {
          return {
            items: [
              {
                actual_qty: 120,
                amount: 565,
                is_stock_item: true,
                item_code: "F61",
                item_name: "Dairy Joy 200ml",
                price_list_rate: 565,
                qty: 1,
                rate: 565,
                uom: "Carton",
              },
            ],
            taxes: [],
            totals: { grand_total: 565, net_total: 565 },
          };
        }
        throw new Error("Unexpected request");
      },
    );
    const hook = await renderHook<
      ReturnType<typeof usePosCart>,
      { customer: PosSaleCustomer | null }
    >(({ customer }) => usePosCart({ customer, posProfile: "POS-001" }), {
      initialProps: { customer: null },
    });

    await act(async () => hook.result.current.add(salesUomItem));
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ rate: 544, uom: "Carton" }),
    ]);

    await hook.rerender({
      customer: { customer: "ABC-CORPS", customerName: "ABC Corps" },
    });
    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.sales.preview_invoice",
        expect.objectContaining({
          customer: "ABC-CORPS",
          items: '[{"item_code":"F61","qty":1,"uom":"Carton"}]',
        }),
      ),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ rate: 565, uom: "Carton" }),
    ]);

    await hook.rerender({ customer: null });
    await waitFor(() =>
      expect(hook.result.current.items).toEqual([
        expect.objectContaining({ rate: 544, uom: "Carton" }),
      ]),
    );
    expect(hook.result.current.subtotal).toBe(544);
  });

  it("recalculates an existing cart when a selected customer is reset to the profile default", async () => {
    const hook = await renderHook<
      ReturnType<typeof usePosCart>,
      { customer: PosSaleCustomer | null }
    >(({ customer }) => usePosCart({ customer, posProfile: "POS-001" }), {
      initialProps: {
        customer: { customer: "CUST-001", customerName: "Example customer" },
      },
    });

    await act(async () => hook.result.current.add(item));
    await hook.rerender({
      customer: {
        customer: "WALK-IN",
        customerName: "Walk-in customer",
        isWalkin: true,
      },
    });

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.sales.preview_invoice",
        expect.objectContaining({ customer: "WALK-IN" }),
      ),
    );
    expect(hook.result.current.requiresCustomer).toBe(false);
  });

  it("keeps the last successful cart visible when Frappe cannot update it", async () => {
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );
    await act(async () => hook.result.current.add(item));
    mockGetVunaMethod.mockRejectedValueOnce(new Error("Network error"));

    let added = true;
    await act(async () => {
      added = await hook.result.current.add(item);
    });

    await waitFor(() =>
      expect(hook.result.current.error).toBe("Network error"),
    );
    expect(added).toBe(false);
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ qty: 1 }),
    ]);
  });

  it("creates a validated draft, holds it, then clears the local cart", async () => {
    mockPostVunaMethod
      .mockResolvedValueOnce({ doctype: "Sales Invoice", name: "SINV-0001" })
      .mockResolvedValueOnce({ doctype: "Sales Invoice", name: "SINV-0001" });
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    let heldInvoice: { doctype: string; name: string } | null = null;
    await act(async () => {
      heldInvoice = await hook.result.current.hold();
    });

    expect(mockPostVunaMethod).toHaveBeenNthCalledWith(
      1,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_invoice_from_cart",
      {
        customer: "CUST-001",
        items: '[{"item_code":"ITEM-001","qty":1,"uom":"Nos"}]',
        pos_profile: "POS-001",
        price_list: undefined,
      },
    );
    expect(mockPostVunaMethod).toHaveBeenNthCalledWith(
      2,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.hold_invoice",
      { invoice_doctype: "Sales Invoice", invoice_name: "SINV-0001" },
    );
    expect(heldInvoice).toEqual({
      doctype: "Sales Invoice",
      name: "SINV-0001",
    });
    expect(mockInvalidateHeldInvoiceCache).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });
    expect(hook.result.current.items).toEqual([]);
  });

  it("retries holding the same draft instead of creating a duplicate after the hold request fails", async () => {
    mockPostVunaMethod
      .mockResolvedValueOnce({ doctype: "Sales Invoice", name: "SINV-0002" })
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ doctype: "Sales Invoice", name: "SINV-0002" });
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.hold();
    });
    expect(hook.result.current.holdError).toBe("Network error");
    expect(hook.result.current.hasPendingHold).toBe(true);

    await act(async () => {
      await hook.result.current.hold();
    });

    expect(mockPostVunaMethod).toHaveBeenCalledTimes(3);
    expect(mockPostVunaMethod.mock.calls[2][2]).toBe(
      "vunapos.api.sales.hold_invoice",
    );
    expect(hook.result.current.items).toEqual([]);
  });

  it("restores a held invoice into the cart while retaining its server draft identity", async () => {
    mockPostVunaMethod.mockResolvedValueOnce({
      customer: "CUST-001",
      customer_name: "Example customer",
      doctype: "Sales Invoice",
      items: [
        {
          actual_qty: 4,
          allow_negative_stock: false,
          is_stock_item: true,
          item_code: "ITEM-001",
          item_name: "Stock item",
          qty: 2,
          rate: 125,
          uom: "Nos",
        },
      ],
      name: "SINV-HELD-001",
      selling_price_list: "Retail",
      taxes: [{ description: "VAT", tax_amount: 40 }],
      totals: { grand_total: 290, net_total: 250 },
    });
    const hook = await renderHook(() =>
      usePosCart({ customer: null, posProfile: "POS-001" }),
    );

    await act(async () => {
      await hook.result.current.restoreHeldInvoice({
        doctype: "Sales Invoice",
        name: "SINV-HELD-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.restore_invoice",
      { invoice_doctype: "Sales Invoice", invoice_name: "SINV-HELD-001" },
    );
    expect(mockInvalidateHeldInvoiceCache).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
    });
    expect(hook.result.current.sourceInvoice).toEqual({
      doctype: "Sales Invoice",
      name: "SINV-HELD-001",
    });
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ item_code: "ITEM-001", qty: 2 }),
    ]);
  });

  it("recalculates the current cart when the cashier switches price lists", async () => {
    const hook = await renderHook<
      ReturnType<typeof usePosCart>,
      { priceList?: string }
    >(
      ({ priceList }) =>
        usePosCart({
          customer: { customer: "CUST-001", customerName: "Example customer" },
          posProfile: "POS-001",
          priceList,
        }),
      { initialProps: { priceList: undefined } },
    );

    await act(async () => hook.result.current.add(item));
    await hook.rerender({ priceList: "Wholesale" });

    await waitFor(() =>
      expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
        "https://vuna.example.com",
        "sid-1",
        "vunapos.api.sales.preview_invoice",
        expect.objectContaining({ price_list: "Wholesale" }),
      ),
    );
  });

  it("refreshes the cart with a selected Item UOM and lets Frappe provide its conversion factor", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItems = JSON.parse(String(params?.items ?? "[]"));
        const uom = cartItems[0]?.uom || "Nos";
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: uom === "Box" ? 1200 : 125,
              conversion_factor: uom === "Box" ? 12 : 1,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              qty: 1,
              rate: uom === "Box" ? 1200 : 125,
              uom,
              uoms: [
                { conversion_factor: 1, uom: "Nos" },
                { conversion_factor: 12, uom: "Box" },
              ],
            },
          ],
          taxes: [],
          totals: {
            grand_total: uom === "Box" ? 1200 : 125,
            net_total: uom === "Box" ? 1200 : 125,
          },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.updateUom("ITEM-001", "Box");
    });

    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items: '[{"item_code":"ITEM-001","qty":1,"uom":"Box"}]',
      }),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({
        conversion_factor: 12,
        rate: 1200,
        uom: "Box",
      }),
    ]);
  });

  it("validates and persists a trimmed item note through the cart preview", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItem = JSON.parse(String(params?.items ?? "[]"))[0];
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: 125,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              item_note: cartItem.item_note || null,
              qty: 1,
              rate: 125,
              uom: "Nos",
            },
          ],
          taxes: [],
          totals: { grand_total: 125, net_total: 125 },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.updateItemNote(
        "ITEM-001",
        "  Handle with care  ",
      );
    });

    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items:
          '[{"item_code":"ITEM-001","item_note":"Handle with care","qty":1,"uom":"Nos"}]',
      }),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({ item_note: "Handle with care" }),
    ]);

    await act(async () => {
      await hook.result.current.updateItemNote("ITEM-001", "x".repeat(501));
    });
    expect(hook.result.current.error).toBe(
      "Item notes cannot exceed 500 characters.",
    );
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(2);
  });

  it("sends permitted manual pricing overrides through the authoritative cart preview", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItem = JSON.parse(String(params?.items ?? "[]"))[0];
        const override = cartItem.pricing_override;
        const priceListRate = 125;
        const rate =
          override?.type === "discount_percentage" ? 112.5 : priceListRate;
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: rate,
              discount_percentage:
                override?.type === "discount_percentage" ? 10 : 0,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              price_list_rate: priceListRate,
              pricing_override_by: override ? "cashier@example.com" : null,
              qty: 1,
              rate,
              uom: "Nos",
            },
          ],
          taxes: [],
          totals: { grand_total: rate, net_total: rate },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.updatePricing("ITEM-001", {
        type: "discount_percentage",
        value: 10,
      });
    });

    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items:
          '[{"item_code":"ITEM-001","pricing_override":{"type":"discount_percentage","value":10},"qty":1,"uom":"Nos"}]',
      }),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({
        discount_percentage: 10,
        pricing_override: { type: "discount_percentage", value: 10 },
        pricing_override_by: "cashier@example.com",
        rate: 112.5,
      }),
    ]);

    await act(async () => {
      await hook.result.current.updatePricing("ITEM-001", {
        type: "discount_percentage",
        value: 101,
      });
    });
    expect(hook.result.current.error).toBe(
      "Enter a valid non-negative pricing value.",
    );
    expect(mockGetVunaMethod).toHaveBeenCalledTimes(2);
  });

  it("persists a manual batch allocation through Frappe before checkout", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItem = JSON.parse(String(params?.items ?? "[]"))[0];
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: 125,
              batch_allocations: cartItem.batch_allocations || [],
              has_batch_no: true,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              qty: 1,
              rate: 125,
              uom: "Nos",
            },
          ],
          taxes: [],
          totals: { grand_total: 125, net_total: 125 },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.updateBatchAllocations("ITEM-001", [
        {
          available_qty: 4,
          batch_no: "BATCH-001",
          expiry_date: "2027-01-01",
          qty: 1,
        },
      ]);
    });

    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items:
          '[{"batch_allocations":[{"batch_no":"BATCH-001","qty":1}],"item_code":"ITEM-001","qty":1,"uom":"Nos"}]',
      }),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({
        batch_allocations: [
          expect.objectContaining({ batch_no: "BATCH-001", qty: 1 }),
        ],
      }),
    ]);
  });

  it("persists an exact serial selection through Frappe before checkout", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, _method, params) => {
        const cartItem = JSON.parse(String(params?.items ?? "[]"))[0];
        return {
          items: [
            {
              actual_qty: 4,
              allow_negative_stock: false,
              amount: 125,
              has_serial_no: true,
              is_stock_item: true,
              item_code: "ITEM-001",
              item_name: "Stock item",
              qty: 1,
              rate: 125,
              serial_allocations: cartItem.serial_allocations || [],
              uom: "Nos",
            },
          ],
          taxes: [],
          totals: { grand_total: 125, net_total: 125 },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.updateSerialAllocations("ITEM-001", [
        { serial_no: "SERIAL-001" },
      ]);
    });

    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items:
          '[{"item_code":"ITEM-001","qty":1,"serial_allocations":[{"serial_no":"SERIAL-001"}],"uom":"Nos"}]',
      }),
    );
    expect(hook.result.current.items).toEqual([
      expect.objectContaining({
        serial_allocations: [{ serial_no: "SERIAL-001" }],
      }),
    ]);
  });

  it("adds the configured delivery item with its server-approved rate override", async () => {
    mockGetVunaMethod.mockImplementation(
      async (_companyUrl, _sessionId, method, params) => {
        if (method === "vunapos.api.item.get_item_details") {
          return {
            actual_qty: null,
            is_stock_item: false,
            item_code: "DELIVERY",
            item_name: "Delivery charge",
            rate: 0,
            stock_uom: "Nos",
          };
        }
        const cartItems = JSON.parse(String(params?.items ?? "[]"));
        return {
          items: cartItems.map(
            (cartItem: {
              item_code: string;
              pricing_override?: { value: number };
              qty: number;
              uom?: string;
            }) => ({
              actual_qty: null,
              allow_negative_stock: false,
              amount: cartItem.pricing_override?.value || 125,
              is_stock_item: cartItem.item_code !== "DELIVERY",
              item_code: cartItem.item_code,
              item_name:
                cartItem.item_code === "DELIVERY"
                  ? "Delivery charge"
                  : "Stock item",
              qty: cartItem.qty,
              rate: cartItem.pricing_override?.value || 125,
              uom: cartItem.uom || "Nos",
            }),
          ),
          taxes: [],
          totals: { grand_total: 175, net_total: 175 },
        };
      },
    );
    const hook = await renderHook(() =>
      usePosCart({
        customer: { customer: "CUST-001", customerName: "Example customer" },
        posProfile: "POS-001",
      }),
    );

    await act(async () => {
      await hook.result.current.add(item);
    });
    await act(async () => {
      await hook.result.current.applyDeliveryCharge("DELIVERY", 50);
    });

    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.item.get_item_details",
      {
        customer: "CUST-001",
        item_code: "DELIVERY",
        pos_profile: "POS-001",
      },
    );
    expect(mockGetVunaMethod).toHaveBeenLastCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({
        items:
          '[{"item_code":"ITEM-001","qty":1,"uom":"Nos"},{"item_code":"DELIVERY","pricing_override":{"type":"rate","value":50},"qty":1,"uom":"Nos"}]',
      }),
    );
    expect(hook.result.current.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          item_code: "DELIVERY",
          pricing_override: { type: "rate", value: 50 },
          rate: 50,
        }),
      ]),
    );
  });
});
