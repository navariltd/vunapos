import { describe, expect, it } from "vitest";
import { restaurantCart } from "../restaurantCart";
import { addMenuItem, newOrderDraft } from "../orderDraft";
import type { ItemDTO } from "../../pos/types";

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
