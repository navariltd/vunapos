import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CheckoutDialog } from "../components/CheckoutDialog";
import type { InvoiceDTO, GatewayPaymentLinkDTO } from "../types";

const state = vi.hoisted(() => ({ invoice: null as unknown, isMutating: false }));
vi.mock("../stores/cartStore", () => ({ useCartStore: (select: (value: typeof state) => unknown) => select(state) }));
vi.mock("../hooks/useGatewayPaymentRealtime", () => ({ useGatewayPaymentRealtime: () => {} }));

const invoice = (name: string, amount: number) => ({ doctype: "Sales Invoice", name, customer: "Guest", items: [
  { item_code: name, item_name: name, row_name: name, qty: 1, uom: "Nos", rate: amount, amount },
], taxes: [], payments: [], totals: { net_total: amount, grand_total: amount, rounded_total: amount } }) as unknown as InvoiceDTO;

describe("controlled restaurant checkout", () => {
  it("renders the session bill without replacing the retail cart or offering cart mutation actions", () => {
    state.invoice = invoice("Retail item", 999);
    const html = renderToStaticMarkup(<CheckoutDialog isOpen hideCartActions
      presentation={{ invoice: invoice("Restaurant dish", 250), isSubmitting: false }}
      modesOfPayment={[{ mode_of_payment: "Cash", default: 1 }]} currency="KES"
      onClose={vi.fn()} onClear={vi.fn()} onHold={vi.fn()} onConfirm={vi.fn()} onPreviewLoyalty={vi.fn()} />);
    expect(html).toContain("Restaurant dish");
    expect(html).not.toContain("Retail item");
    expect(html).not.toContain(" Hold");
    expect(html).not.toContain(" Clear");
    expect(html).toMatch(/class="grid shrink-0 grid-cols-2[^"]*xl:justify-end/);
    expect(state.invoice).toMatchObject({ name: "Retail item" });
  });

  it("retains retail presentation when no override was supplied", () => {
    state.invoice = invoice("Retail item", 999);
    const html = renderToStaticMarkup(<CheckoutDialog isOpen modesOfPayment={[{ mode_of_payment: "Cash", default: 1 }]}
      onClose={vi.fn()} onClear={vi.fn()} onHold={vi.fn()} onConfirm={vi.fn()} onPreviewLoyalty={vi.fn()} />);
    expect(html).toContain("Retail item");
    expect(html).toContain("Hold");
    expect(html).not.toMatch(/class="grid shrink-0 grid-cols-2[^"]*xl:justify-end/);
  });

  it("restores verified gateway state instead of presenting a fresh payment prompt", () => {
    const recovered = { name: "VPGL-1", mode_of_payment: "M-Pesa", amount: 250, status: "Paid", transaction_reference: "CONFIRMED" } as GatewayPaymentLinkDTO;
    const html = renderToStaticMarkup(<CheckoutDialog isOpen hideCartActions
      presentation={{ invoice: invoice("Restaurant dish", 250), isSubmitting: false }} initialGatewayLinks={[recovered]}
      modesOfPayment={[{ mode_of_payment: "Cash", default: 1 }, { mode_of_payment: "M-Pesa", payment_gateway: "Test Gateway" }]} currency="KES"
      onClose={vi.fn()} onClear={vi.fn()} onHold={vi.fn()} onConfirm={vi.fn()} onPreviewLoyalty={vi.fn()} />);
    expect(html).toContain("Verified gateway payment");
    expect(html).toContain("CONFIRMED");
  });
});
