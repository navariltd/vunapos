import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ModifierPicker } from "../components/ModifierPicker";
import { modifierSelectionError } from "../modifierSelections";
import {
  addMenuItem,
  newOrderDraft,
  planSave,
  removeUnsent,
  setUnsentQty,
} from "../orderDraft";
import { restaurantCart } from "../restaurantCart";
import type { ModifierGroupDTO, SelectedModifier } from "../types";

const groups: ModifierGroupDTO[] = [
  {
    name: "Milk",
    label: "Milk choice",
    min_selections: 1,
    max_selections: 1,
    options: [
      { name: "plain", label: "Plain", rate: 0, addon_qty: 0, available: true },
      {
        name: "extra",
        label: "Extra milk",
        addon_item: "Milk",
        rate: 25,
        addon_qty: 3,
        available: true,
      },
      {
        name: "oat",
        label: "Oat milk",
        rate: 30,
        addon_qty: 1,
        available: false,
      },
    ],
  },
];
const selected: SelectedModifier[] = [
  {
    group: "Milk",
    option: "extra",
    label: "Milk choice: Extra milk",
    extra_rate: 75,
  },
];
const baseItem = {
  item_code: "Tea",
  item_name: "Tea",
  uom: "Cup",
  stock_uom: "Cup",
  rate: 100,
};
const draft = () =>
  newOrderDraft({
    pos_profile: "Till",
    service_type: "Takeaway",
    idempotency_key: "retry",
  });

describe("restaurant modifier choices", () => {
  it("enforces required choices and maximum counts", () => {
    expect(modifierSelectionError(groups, [])).toContain("Choose 1");
    expect(modifierSelectionError(groups, selected)).toBeNull();
    expect(
      modifierSelectionError(groups, [
        ...selected,
        { group: "Milk", option: "plain" },
      ])
    ).toContain("Choose 1");
  });
  it("rejects unknown groups, duplicate choices and unavailable choices", () => {
    expect(
      modifierSelectionError(groups, [{ group: "Unknown", option: "extra" }])
    ).not.toBeNull();
    expect(
      modifierSelectionError(groups, [...selected, ...selected])
    ).not.toBeNull();
    expect(
      modifierSelectionError(groups, [{ group: "Milk", option: "oat" }])
    ).toContain("unavailable");
  });
  it("allows zero choices for optional groups", () => {
    expect(
      modifierSelectionError([{ ...groups[0], min_selections: 0 }], [])
    ).toBeNull();
  });
  it("merges only identical item/UOM/customization combinations", () => {
    let counter = 0;
    const id = () => `line-${++counter}`;
    let current = addMenuItem(
      draft(),
      { ...baseItem, modifiers: selected },
      id
    );
    current = addMenuItem(current, { ...baseItem, modifiers: selected }, id);
    current = addMenuItem(
      current,
      {
        ...baseItem,
        modifiers: [{ ...selected[0], option: "plain", extra_rate: 0 }],
      },
      id
    );
    expect(current.unsent).toHaveLength(2);
    expect(current.unsent.map((line) => line.qty)).toEqual([2, 1]);
  });
  it("includes extras in estimates and scales them with quantity", () => {
    const current = setUnsentQty(
      addMenuItem(draft(), { ...baseItem, modifiers: selected }, () => "line"),
      "line",
      2
    );
    expect(restaurantCart(current, [baseItem]).totals.grand_total).toBe(350);
    expect(
      restaurantCart(removeUnsent(current, "line"), [baseItem]).totals
        .grand_total
    ).toBe(0);
  });
  it("sends only trusted identifiers, never client prices or add-on rows", () => {
    const current = addMenuItem(
      draft(),
      { ...baseItem, modifiers: selected },
      () => "line"
    );
    const step = planSave(current)[0];
    expect(step.kind).toBe("create");
    if (step.kind === "create") {
      expect(step.params.items[0].modifiers).toEqual([
        { group: "Milk", option: "extra" },
      ]);
      expect(step.params.items).toHaveLength(1);
      expect(JSON.stringify(step.params)).not.toContain("extra_rate");
    }
  });
  it("shows required instructions, priced extras and unavailable options in the picker", () => {
    const html = renderToStaticMarkup(
      <ModifierPicker
        itemName="Tea"
        groups={groups}
        currency="KES"
        onConfirm={() => {}}
        onClose={() => {}}
      />
    );
    expect(html).toContain("Customize Tea");
    expect(html).toContain("Required");
    expect(html).toContain("Unavailable");
    expect(html).toContain("Confirm choices");
    expect(html).toContain("disabled");
  });
});
