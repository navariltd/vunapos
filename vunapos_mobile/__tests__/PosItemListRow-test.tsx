import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

import { PosItemListRow } from "@/features/pos/components/PosItemListRow";

const item = {
  actual_qty: 8,
  is_stock_item: true,
  item_code: "ITEM-001",
  item_name: "Compact item",
  item_tax: { inclusive: true, inclusive_tax_rate: 16 },
  rate: 50,
  stock_uom: "Nos",
};

describe("PosItemListRow", () => {
  it("keeps the complete price, tax, stock, and add context in list mode", async () => {
    const onAdd = jest.fn();
    const screen = await render(
      <PosItemListRow currency="KES" item={item} onAdd={onAdd} />,
    );

    expect(screen.getByText("Compact item")).toBeTruthy();
    expect(screen.getByText("ITEM-001 · Nos")).toBeTruthy();
    expect(screen.getByText("Tax incl. · 16%")).toBeTruthy();
    expect(screen.getByText("KES 50.00")).toBeTruthy();
    expect(screen.getByText("Qty 8")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Add Compact item"));
    expect(onAdd).toHaveBeenCalledWith(item);
  });

  it("does not allow an exhausted stock item to be added", async () => {
    const onAdd = jest.fn();
    const screen = await render(
      <PosItemListRow
        currency="KES"
        item={{ ...item, actual_qty: 0 }}
        onAdd={onAdd}
      />,
    );

    expect(screen.getByText("Out of stock")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Add Compact item"));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
