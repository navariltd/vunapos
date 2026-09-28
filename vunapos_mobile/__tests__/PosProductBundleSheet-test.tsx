import { fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

import { PosProductBundleSheet } from "@/features/pos/components/PosProductBundleSheet";

describe("PosProductBundleSheet", () => {
  it("shows server bundle components and requires explicit confirmation", async () => {
    const onConfirm = jest.fn();
    const screen = await render(
      <PosProductBundleSheet
        bundle={{
          available_qty: 3,
          item_code: "PACK-001",
          items: [
            {
              available_qty: 8,
              item_code: "ITEM-001",
              item_name: "Coffee",
              qty: 2,
              uom: "Nos",
            },
          ],
        }}
        error={null}
        isAdding={false}
        isLoading={false}
        itemName="Starter pack"
        onConfirm={onConfirm}
        onDismiss={jest.fn()}
        visible
      />,
    );
    expect(screen.getByText("Review bundle")).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("ITEM-001 · 2 Nos")).toBeTruthy();
    expect(screen.getByText("8 available")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Confirm add bundle"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
