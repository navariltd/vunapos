import { fireEvent, render } from "@testing-library/react-native";

import { PosItemSearch } from "@/features/pos/components/PosItemSearch";

describe("PosItemSearch", () => {
  it("submits the typed search when the keyboard search key is pressed", async () => {
    const onSubmit = jest.fn();
    const screen = await render(
      <PosItemSearch
        onChangeText={jest.fn()}
        onScanBarcode={jest.fn()}
        onSubmit={onSubmit}
        value="0123456789"
      />,
    );

    fireEvent(screen.getByLabelText("Search items"), "submitEditing");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
