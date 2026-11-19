import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { kitchenDishGroups } from "../kitchenDishes";
import { KitchenDishes } from "../components/KitchenDishes";
import type { KitchenTicketDTO } from "../types";

vi.mock("frappe-react-sdk", () => ({
  useFrappePostCall: () => ({ call: vi.fn() }),
}));

const dish = {
  line_id: "drink",
  item_code: "ESPRESSO",
  item_name: "Espresso",
  qty: 4,
  uom: "Cup",
  stock_qty: 4,
  stock_uom: "Cup",
  temporary_routing: false,
  accepted_qty: 4,
  ready_to_serve_qty: 4,
  note: "No sugar",
  modifiers: [{ label: "Oat milk", addon_item: "OAT" }, { label: "Extra hot" }],
};
const addon = {
  ...dish,
  line_id: "drink:addon:0",
  parent_line_id: "drink",
  item_code: "OAT",
  item_name: "Oat milk",
  modifiers: [],
  note: "Add-on for ESPRESSO: Oat milk",
};
const ticket = {
  status: "Ready",
  items: [dish, addon],
} as unknown as KitchenTicketDTO;

describe("kitchen-readable dishes", () => {
  it("shows an add-on once beneath its parent without duplicated progress or generated reference notes", () => {
    const before = JSON.stringify(ticket);
    const html = renderToStaticMarkup(<KitchenDishes ticket={ticket} />);
    expect(html.match(/Oat milk/g)).toHaveLength(1);
    expect(html.match(/ready to serve/g)).toHaveLength(1);
    expect(html).toContain("+ Oat milk");
    expect(html).toContain("Extra hot");
    expect(html).toContain("No sugar");
    expect(html).not.toContain("Add-on for ESPRESSO:");
    expect(JSON.stringify(ticket)).toBe(before);
  });

  it("keeps explicit quantities when an add-on has a different quantity or UOM", () => {
    const html = renderToStaticMarkup(
      <KitchenDishes
        ticket={{ ...ticket, items: [dish, { ...addon, qty: 8, uom: "Shot" }] }}
      />
    );
    expect(html).toContain("8 Shot ×");
    expect(html).toContain("Oat milk");
  });

  it("preserves genuine add-on instructions, even when they begin like a reference", () => {
    const custom =
      "Add-on for ESPRESSO: Oat milk\nNut allergy — use a clean jug";
    const groups = kitchenDishGroups([dish, { ...addon, note: custom }]);
    expect(groups[0].addons[0].note).toBe(custom);
    const html = renderToStaticMarkup(
      <KitchenDishes
        ticket={{
          ...ticket,
          items: [dish, { ...addon, note: "Nut allergy — use a clean jug" }],
        }}
      />
    );
    expect(html).toContain("Nut allergy — use a clean jug");
  });

  it("groups by line ID, not item code, and works when children arrive before their parent", () => {
    const second = { ...dish, line_id: "drink-2" };
    const secondAddon = {
      ...addon,
      line_id: "drink-2:addon:0",
      parent_line_id: "drink-2",
    };
    const groups = kitchenDishGroups([secondAddon, dish, addon, second]);
    expect(
      groups.map((group) => [group.dish.line_id, group.addons[0].line.line_id])
    ).toEqual([
      ["drink", "drink:addon:0"],
      ["drink-2", "drink-2:addon:0"],
    ]);
  });

  it("does not silently lose an add-on whose parent is absent from the response", () => {
    expect(kitchenDishGroups([addon])[0].dish.line_id).toBe(addon.line_id);
  });
});
