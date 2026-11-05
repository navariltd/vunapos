import { describe, expect, it } from "vitest";
import { applyRestaurantPreview, restaurantCart } from "../restaurantCart";
import { addMenuItem, newOrderDraft } from "../orderDraft";
import type { InvoiceDTO, ItemDTO } from "../../pos/types";
import type { MenuDTO } from "../types";

const item = {
  item_code: "Tea",
  item_name: "Tea",
  uom: "Cup",
  stock_uom: "Cup",
  conversion_factor: 1,
  rate: 85,
  actual_qty: 0,
  has_batch_no: 1,
  uoms: [
    { uom: "Cup", conversion_factor: 1, rate: 100 },
    { uom: "Pot", conversion_factor: 3, rate: 240 },
  ],
} as ItemDTO;

function draft() {
  return addMenuItem(
    newOrderDraft({
      pos_profile: "Till",
      service_type: "Dine In",
      customer: "Guest",
      idempotency_key: "key",
    }),
    item,
    () => "line-1"
  );
}

describe("shared restaurant cart presentation", () => {
  const pricing: Pick<MenuDTO, "pricing_context" | "modifier_groups"> = {
    pricing_context: {
      tax_rows: [
        {
          account_head: "VAT",
          charge_type: "On Net Total",
          rate: 16,
          included_in_print_rate: false,
        },
      ],
      tax_settings: {
        addTaxesFromItemTaxTemplate: false,
        addTaxesFromTaxesAndChargesTemplate: true,
      },
    },
  };

  it("reuses retail's local tax engine for immediate exclusive totals", () => {
    const result = restaurantCart(draft(), [item], pricing);
    expect(result.totals.net_total).toBe(85);
    expect(result.totals.total_taxes_and_charges).toBe(13.6);
    expect(result.totals.grand_total).toBe(98.6);
  });

  it("extracts included taxes instead of adding them twice", () => {
    const result = restaurantCart(draft(), [{ ...item, rate: 116 }], {
      pricing_context: {
        ...pricing.pricing_context!,
        tax_rows: [
          {
            ...pricing.pricing_context!.tax_rows[0],
            included_in_print_rate: true,
          },
        ],
      },
    });
    expect(result.totals.net_total).toBe(100);
    expect(result.totals.total_taxes_and_charges).toBe(16);
    expect(result.totals.grand_total).toBe(116);
  });

  it("calculates two UOM rows independently", () => {
    const current = addMenuItem(
      draft(),
      { ...item, uom: "Pot" },
      () => "line-2"
    );
    current.unsent[1].qty = 2;
    const result = restaurantCart(current, [item], pricing);
    expect(result.items.map((row) => row.rate)).toEqual([85, 240]);
    expect(result.totals.net_total).toBe(565);
    expect(result.totals.total_taxes_and_charges).toBe(90.4);
  });

  it("keeps add-on tax treatment separate while presenting one editable dish", () => {
    const current = draft();
    current.unsent[0].modifiers = [
      { group: "Extras", option: "Milk", label: "Milk", extra_rate: 20 },
    ];
    const tax = {
      template: "VAT",
      accounts: [
        { account_head: "VAT", rate: 16, included_in_print_rate: false },
      ],
    } as ItemDTO["item_tax"];
    const result = restaurantCart(current, [{ ...item, item_tax: tax }], {
      pricing_context: {
        ...pricing.pricing_context!,
        tax_settings: {
          addTaxesFromItemTaxTemplate: true,
          addTaxesFromTaxesAndChargesTemplate: false,
        },
      },
      modifier_groups: {
        Tea: [
          {
            name: "Extras",
            label: "Extras",
            min_selections: 0,
            max_selections: 1,
            options: [
              {
                name: "Milk",
                label: "Milk",
                addon_item: "Milk",
                addon_qty: 2,
                rate: 10,
                available: true,
                item_tax: {
                  ...tax!,
                  accounts: [
                    {
                      account_head: "VAT",
                      rate: 0,
                      included_in_print_rate: false,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].rate).toBe(105);
    expect(result.totals.grand_total).toBe(118.6);
  });

  it("uses native totals and folds trusted add-ons without losing cart identities", () => {
    const local = restaurantCart(draft(), [item]);
    const preview: InvoiceDTO = {
      ...local,
      items: [
        { ...local.items[0], rate: 100, price_list_rate: 100, amount: 100 },
        {
          ...local.items[0],
          row_name: "extra-1",
          restaurant_parent_line_id: "line-1",
          item_code: "Milk",
          qty: 2,
          rate: 10,
          price_list_rate: 10,
          amount: 20,
        },
      ],
      taxes: [],
      totals: {
        net_total: 120,
        total_taxes_and_charges: 19.2,
        grand_total: 139.2,
      },
    };
    const result = applyRestaurantPreview(local, preview);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].row_name).toBe("line-1");
    expect(result.items[0].rate).toBe(120);
    expect(result.totals.grand_total).toBe(139.2);
  });
  it("carries contextual QSR classification into cart item details", () => {
    expect(
      restaurantCart(draft(), [{ ...item, is_qsr: true }]).items[0].is_qsr
    ).toBe(true);
    expect(restaurantCart(draft(), [item]).items[0].is_qsr).toBeUndefined();
  });
  it("uses the retail cart DTO shape without creating an invoice or applying stock tracking", () => {
    const invoice = restaurantCart(draft(), [item]);
    expect(invoice.doctype).toBe("Sales Order");
    expect(invoice.docstatus).toBe(0);
    expect(invoice.items[0].row_name).toBe("line-1");
    expect(invoice.items[0].has_batch_no).toBe(false);
    expect(invoice.items[0].rate).toBe(85);
  });
  it("shows alternate UOM rates and preserves notes", () => {
    const current = draft();
    current.unsent[0] = {
      ...current.unsent[0],
      uom: "Pot",
      qty: 2,
      note: "No sugar",
    };
    const invoice = restaurantCart(current, [item]);
    expect(invoice.items[0].rate).toBe(240);
    expect(invoice.items[0].conversion_factor).toBe(3);
    expect(invoice.items[0].item_note).toBe("No sugar");
    expect(invoice.totals.grand_total).toBe(480);
  });
  it("does not merge different UOM rows", () => {
    const current = addMenuItem(
      draft(),
      { ...item, uom: "Pot" },
      () => "line-2"
    );
    expect(current.unsent).toHaveLength(2);
    expect(current.unsent.map((row) => row.uom)).toEqual(["Cup", "Pot"]);
  });
});
