import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: jest.fn(),
}));

jest.mock("@/services/frappeClient", () => ({
  FrappeClientError: class FrappeClientError extends Error {},
  getVunaMethod: jest.fn(),
  postVunaMethod: jest.fn(),
}));

const mockInvalidateSaleCache = jest.fn();
jest.mock("@/services/posCacheInvalidation", () => ({
  invalidateSaleCache: (...args: unknown[]) => mockInvalidateSaleCache(...args),
}));

import { useAppSession } from "@/features/auth/AppSessionProvider";
import {
  usePosCheckoutPreview,
  useSubmitPosCheckout,
} from "@/features/pos/hooks/usePosCheckout";
import { getVunaMethod, postVunaMethod } from "@/services/frappeClient";

const mockUseAppSession = jest.mocked(useAppSession);
const mockGetVunaMethod = jest.mocked(getVunaMethod);
const mockPostVunaMethod = jest.mocked(postVunaMethod);
const invalidateSession = jest.fn();
const item = {
  allow_negative_stock: false,
  available_qty: 4,
  is_stock_item: true,
  item_code: "ITEM-001",
  item_name: "Stock item",
  qty: 2,
  rate: 125,
  uom: "Nos",
};

describe("POS checkout hooks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvalidateSaleCache.mockResolvedValue(undefined);
    mockUseAppSession.mockReturnValue({
      companyUrl: "https://vuna.example.com",
      invalidateSession,
      sessionId: "sid-1",
    } as unknown as ReturnType<typeof useAppSession>);
  });

  afterEach(async () => {
    await cleanup();
  });

  it("requests a server preview with only cart data needed for pricing and stock validation", async () => {
    mockGetVunaMethod.mockResolvedValue({
      totals: { grand_total: 290, net_total: 250 },
    });
    const hook = await renderHook(() =>
      usePosCheckoutPreview({
        customer: "CUST-001",
        items: [item],
        posProfile: "POS-001",
      }),
    );

    await waitFor(() =>
      expect(hook.result.current.data).toEqual({
        totals: { grand_total: 290, net_total: 250 },
      }),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      {
        customer: "CUST-001",
        items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
        pos_profile: "POS-001",
      },
      expect.any(AbortSignal),
    );
  });

  it("re-previews the cart with requested loyalty points so the server validates the redemption", async () => {
    mockGetVunaMethod.mockResolvedValue({
      loyalty_amount: 20,
      loyalty_points: 10,
      totals: { grand_total: 290, net_total: 250 },
    });
    const hook = await renderHook(() =>
      usePosCheckoutPreview({
        customer: "CUST-001",
        items: [item],
        loyaltyPoints: 10,
        posProfile: "POS-001",
      }),
    );

    await waitFor(() =>
      expect(hook.result.current.data?.loyalty_amount).toBe(20),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      {
        customer: "CUST-001",
        items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
        loyalty_points: 10,
        pos_profile: "POS-001",
      },
      expect.any(AbortSignal),
    );
  });

  it("submits a checkout with serialized cart, payment allocation, and a retry-safe key", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-0001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());
    let result:
      Awaited<ReturnType<typeof hook.result.current.submit>> | undefined;

    await act(async () => {
      result = await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(result).toEqual({ doctype: "Sales Invoice", name: "SINV-0001" });
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      {
        customer: "CUST-001",
        idempotency_key: expect.stringMatching(/^mobile-checkout-/),
        items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
        payments: '[{"amount":290,"mode_of_payment":"Cash"}]',
        pos_profile: "POS-001",
      },
    );
    expect(mockInvalidateSaleCache).toHaveBeenCalledWith({
      companyUrl: "https://vuna.example.com",
      posProfile: "POS-001",
      sessionId: "sid-1",
      sourceInvoice: undefined,
    });
  });

  it("serializes configured checkout values only when the cashier supplied them", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-FIELDS-001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        checkoutFields: {
          custom_delivery_note: "",
          custom_project: "PROJ-001",
          custom_terms_accepted: "0",
        },
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({
        checkout_fields: JSON.stringify({
          custom_project: "PROJ-001",
          custom_terms_accepted: "0",
        }),
      }),
    );
  });

  it("keeps the server validation message when configured checkout values are rejected", async () => {
    mockPostVunaMethod.mockRejectedValue(
      new Error("Purchase order is required before checkout."),
    );
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        checkoutFields: { custom_purchase_order: "PO-001" },
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(hook.result.current.error).toBe(
      "Purchase order is required before checkout.",
    );
  });

  it("updates and submits the restored draft instead of creating a new invoice", async () => {
    mockPostVunaMethod
      .mockResolvedValueOnce({
        doctype: "Sales Invoice",
        name: "SINV-HELD-001",
      })
      .mockResolvedValueOnce({
        doctype: "Sales Invoice",
        name: "SINV-HELD-001",
      });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
        sourceInvoice: { doctype: "Sales Invoice", name: "SINV-HELD-001" },
      });
    });

    expect(mockPostVunaMethod).toHaveBeenNthCalledWith(
      1,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.update_invoice_from_cart",
      {
        customer: "CUST-001",
        invoice_doctype: "Sales Invoice",
        invoice_name: "SINV-HELD-001",
        items: '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"}]',
        price_list: undefined,
      },
    );
    expect(mockPostVunaMethod).toHaveBeenNthCalledWith(
      2,
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.checkout_invoice",
      expect.objectContaining({
        invoice_doctype: "Sales Invoice",
        invoice_name: "SINV-HELD-001",
        payments: '[{"amount":290,"mode_of_payment":"Cash"}]',
      }),
    );
  });

  it("sends credit-only fields only when the cashier enables a credit sale", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-0002",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        dueDate: "2026-09-30",
        isCreditSale: true,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 40, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({
        due_date: "2026-09-30",
        is_credit_sale: true,
      }),
    );
  });

  it("preserves the selected price list through preview and final submission", async () => {
    mockGetVunaMethod.mockResolvedValue({
      totals: { grand_total: 180, net_total: 180 },
    });
    const preview = await renderHook(() =>
      usePosCheckoutPreview({
        customer: "CUST-001",
        items: [item],
        posProfile: "POS-001",
        priceList: "Wholesale",
      }),
    );
    await waitFor(() =>
      expect(preview.result.current.data?.totals.grand_total).toBe(180),
    );
    expect(mockGetVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.preview_invoice",
      expect.objectContaining({ price_list: "Wholesale" }),
      expect.any(AbortSignal),
    );

    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-PRICE-001",
    });
    const submit = await renderHook(() => useSubmitPosCheckout());
    await act(async () => {
      await submit.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 180, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
        priceList: "Wholesale",
      });
    });
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({ price_list: "Wholesale" }),
    );
  });

  it("submits only server-validated loyalty points with an Invoice", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-0004",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        loyaltyPoints: 10,
        orderType: "Invoice",
        payments: [{ amount: 270, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({ loyalty_points: 10 }),
    );
  });

  it("sends a Tax ID only when a walk-in checkout provides one", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-0005",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-WALKIN",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
        taxId: "  A123456789Z  ",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({ tax_id: "A123456789Z" }),
    );
  });

  it("submits only the selected permitted shipping address name", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-SHIP-001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
        shippingAddressName: "  ADDR-001  ",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({ shipping_address_name: "ADDR-001" }),
    );
  });

  it("preserves the configured delivery-rate override in the final server submission", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-DELIVERY-001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [
          ...[item],
          {
            allow_negative_stock: false,
            available_qty: null,
            is_stock_item: false,
            item_code: "DELIVERY",
            item_name: "Delivery charge",
            pricing_override: { type: "rate", value: 50 },
            qty: 1,
            rate: 50,
            uom: "Nos",
          },
        ],
        orderType: "Invoice",
        payments: [{ amount: 340, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({
        items:
          '[{"item_code":"ITEM-001","qty":2,"uom":"Nos"},{"item_code":"DELIVERY","pricing_override":{"type":"rate","value":50},"qty":1,"uom":"Nos"}]',
      }),
    );
  });

  it("submits the active server-issued salesperson session with the checkout", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-PIN-001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [{ amount: 290, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
        salesperson: "SP-001",
        salespersonToken: "server-issued-token",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({
        salesperson: "SP-001",
        salesperson_token: "server-issued-token",
      }),
    );
  });

  it("serializes manual payment transaction references for invoice checkout", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Invoice",
      name: "SINV-0003",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        customer: "CUST-001",
        isCreditSale: false,
        items: [item],
        orderType: "Invoice",
        payments: [
          {
            amount: 290,
            mode_of_payment: "Bank transfer",
            reference_date: "2026-09-08",
            reference_no: "RCP-001",
          },
        ],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_invoice",
      expect.objectContaining({
        payments:
          '[{"amount":290,"mode_of_payment":"Bank transfer","reference_date":"2026-09-08","reference_no":"RCP-001"}]',
      }),
    );
  });

  it("uses the sales-order endpoint with a delivery date and without invoice-only fields", async () => {
    mockPostVunaMethod.mockResolvedValue({
      doctype: "Sales Order",
      name: "SAL-ORD-0001",
    });
    const hook = await renderHook(() => useSubmitPosCheckout());

    await act(async () => {
      await hook.result.current.submit({
        deliveryDate: "2026-09-30",
        isCreditSale: false,
        items: [item],
        orderType: "Order",
        payments: [{ amount: 40, mode_of_payment: "Cash" }],
        posProfile: "POS-001",
      });
    });

    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_sales_order",
      expect.objectContaining({
        delivery_date: "2026-09-30",
        payments: '[{"amount":40,"mode_of_payment":"Cash"}]',
      }),
    );
    expect(mockPostVunaMethod).toHaveBeenCalledWith(
      "https://vuna.example.com",
      "sid-1",
      "vunapos.api.sales.create_and_submit_sales_order",
      expect.not.objectContaining({
        due_date: expect.anything(),
        is_credit_sale: expect.anything(),
      }),
    );
  });
});
