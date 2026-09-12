import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

import { PosItemCard } from "@/features/pos/components/PosItemCard";

const item = {
  actual_qty: 8,
  image: "/files/item.png",
  is_stock_item: true,
  item_code: "ITEM-001",
  item_name: "Item with image",
  item_tax: { exclusive_tax_rate: 16, inclusive: false },
  rate: 50,
  stock_uom: "Nos",
};

describe("PosItemCard", () => {
  it("shows the supplied image alongside the full catalogue pricing context", async () => {
    const screen = await render(
      <PosItemCard
        currency="KES"
        imageUrl="https://vuna.example.com/files/item.png"
        item={item}
        onAdd={jest.fn()}
      />,
    );

    expect(screen.getByTestId("Item image ITEM-001").props.source).toEqual({
      uri: "https://vuna.example.com/files/item.png",
    });
    expect(screen.getByText("ITEM-001")).toBeTruthy();
    expect(screen.getByText("Tax excl. · 16%")).toBeTruthy();
    expect(screen.getByText("KES 50.00")).toBeTruthy();
    expect(screen.getByText("Qty 8")).toBeTruthy();
  });

  it("uses the item name as a fallback preview and adds available items", async () => {
    const onAdd = jest.fn();
    const screen = await render(
      <PosItemCard currency="KES" item={item} onAdd={onAdd} />,
    );

    expect(screen.getAllByText("Item with image")).toHaveLength(2);
    expect(screen.queryByTestId("Item image ITEM-001")).toBeNull();
    fireEvent.press(screen.getByLabelText("Add Item with image"));
    expect(onAdd).toHaveBeenCalledWith(item);
  });

  it("marks bundles and leaves their availability to the authoritative cart", async () => {
    const onAdd = jest.fn();
    const screen = await render(
      <PosItemCard
        currency="KES"
        item={{ ...item, actual_qty: 0, is_product_bundle: true }}
        onAdd={onAdd}
      />,
    );

    expect(screen.getByText("Bundle")).toBeTruthy();
    expect(screen.queryByText("Out of stock")).toBeNull();
    fireEvent.press(screen.getByLabelText("Add Item with image"));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ is_product_bundle: true }),
    );
  });

  it("shows an adding state that prevents duplicate add actions", async () => {
    const onAdd = jest.fn();
    const screen = await render(
      <PosItemCard currency="KES" isAdding item={item} onAdd={onAdd} />,
    );

    expect(screen.getByLabelText("Adding Item with image")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Adding Item with image"));
    expect(onAdd).not.toHaveBeenCalled();
  });
});
