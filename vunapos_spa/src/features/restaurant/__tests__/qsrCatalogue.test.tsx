import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ItemCard } from "../../pos/components/ItemCard";
import { ItemListRow } from "../../pos/components/ItemListRow";
import { VariantPickerDialog } from "../../pos/components/VariantPickerDialog";
import type { ItemDTO } from "../../pos/types";

const dish: ItemDTO = {
  item_code: "Tea",
  item_name: "Tea",
  actual_qty: 0,
  is_stock_item: 1,
  stock_uom: "Cup",
  uom: "Cup",
  is_qsr: true,
};

describe("contextual QSR catalogue", () => {
  it("shows QSR instead of finished-stock warnings in grid and list", () => {
    for (const Component of [ItemCard, ItemListRow]) {
      const html = renderToStaticMarkup(
        <Component item={dish} onAdd={() => {}} />
      );
      expect(html).toContain("QSR");
      expect(html).not.toContain("Out of stock");
      expect(html).not.toContain('disabled=""');
    }
  });
  it("still disables unavailable direct-sale stock items", () => {
    const html = renderToStaticMarkup(
      <ItemCard item={{ ...dish, is_qsr: false }} onAdd={() => {}} />
    );
    expect(html).toContain("Out of stock");
    expect(html).toContain('disabled=""');
  });
  it("allows mapped variants without bypassing direct-sale variant stock", () => {
    const html = renderToStaticMarkup(
      <VariantPickerDialog
        isOpen
        template={{ ...dish, has_variants: true }}
        variants={[dish]}
        onClose={() => {}}
        onSelect={() => {}}
      />
    );
    expect(html).toContain("QSR · Made to order");
    expect(html).not.toContain('disabled=""');
  });
});
