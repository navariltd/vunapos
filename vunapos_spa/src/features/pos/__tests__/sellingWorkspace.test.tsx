import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { SellingWorkspace } from "../components/SellingWorkspace";
import { CartPanel } from "../components/CartPanel";
import { useCartStore } from "../stores/cartStore";

vi.mock("../components/CustomerSelector", () => ({
  CustomerSelector: () => <div>Customer selector</div>,
}));
vi.mock("../components/CustomerLoyaltyCard", () => ({
  CustomerLoyaltyCard: () => null,
}));

describe("one selling interface", () => {
  it("uses the same retail search and catalogue layout with optional menu categories", () => {
    const html = renderToStaticMarkup(
      <SellingWorkspace
        query=""
        onQueryChange={() => {}}
        view="grid"
        onViewChange={() => {}}
        onScan={() => {}}
        onOpenCamera={() => {}}
        onAddItem={() => {}}
        items={[]}
        categories={<nav>Menu sections</nav>}
      >
        <aside>Cart</aside>
      </SellingWorkspace>
    );
    expect(html).toContain("Search by item name, code, or barcode");
    expect(html).toContain("Menu sections");
    expect(html).toContain("Switch to list view");
  });
  it("adds restaurant context to the existing cart without mutating the retail store", () => {
    const before = useCartStore.getState().invoice;
    const noop = async () => {};
    const props: ComponentProps<typeof CartPanel> = {
      presentation: {
        invoice: {
          doctype: "Sales Order",
          name: "",
          docstatus: 0,
          items: [],
          totals: {},
        },
        customer: null,
        isMutating: false,
      },
      beforeCustomer: <div>Dine In · Takeaway</div>,
      primaryActionLabel: "Send round",
      hideHold: true,
      estimated: true,
      onCheckout: noop,
      onClearCustomer: noop,
      onClearCart: noop,
      onHold: noop,
      onLoadBatches: async (item_code) => ({ item_code, batches: [] }),
      onRemoveItem: noop,
      onSelectCustomer: noop,
      onSelectPriceList: noop,
      onUpdateQty: noop,
      onUpdatePricing: noop,
      onUpdateNote: noop,
      onUpdateBatchAllocations: noop,
      onUpdateUom: noop,
      onUpdateSerialAllocations: noop,
      onSelectShippingAddress: noop,
      isOnline: true,
    };
    const html = renderToStaticMarkup(<CartPanel {...props} />);
    expect(html.indexOf("Dine In")).toBeLessThan(
      html.indexOf("Customer selector")
    );
    expect(html).toContain("Send round");
    expect(html).not.toContain("Continue Checkout");
    expect(html).not.toContain(">Hold<");
    expect(useCartStore.getState().invoice).toBe(before);
  });
});
