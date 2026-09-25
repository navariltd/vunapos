import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

import { PosVariantPickerSheet } from "@/features/pos/components/PosVariantPickerSheet";

const variant = {
  actual_qty: 4,
  attributes: [
    { attribute: "Colour", value: "Blue" },
    { attribute: "Size", value: "M" },
  ],
  is_stock_item: true,
  item_code: "SHIRT-BLUE-M",
  item_name: "Vuna shirt · Blue · M",
  rate: 1200,
  stock_uom: "Nos",
};

describe("PosVariantPickerSheet", () => {
  it("shows selectable concrete variants with their attributes and pricing", async () => {
    const onSelect = jest.fn();
    const screen = await render(
      <PosVariantPickerSheet
        currency="KES"
        error={null}
        isLoading={false}
        onDismiss={jest.fn()}
        onRetry={jest.fn()}
        onSelect={onSelect}
        templateName="Vuna shirt"
        variants={[variant]}
        visible
      />,
    );

    expect(screen.getByText("Choose a variant")).toBeTruthy();
    expect(screen.getByText("Colour: Blue · Size: M")).toBeTruthy();
    expect(screen.getByText("KES 1,200.00")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Add variant Vuna shirt · Blue · M"));
    expect(onSelect).toHaveBeenCalledWith(variant);
  });
});
