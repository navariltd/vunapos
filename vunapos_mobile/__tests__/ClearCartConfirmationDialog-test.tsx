import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));

import { ClearCartConfirmationDialog } from "@/features/pos/components/ClearCartConfirmationDialog";

describe("ClearCartConfirmationDialog", () => {
  const onConfirm = jest.fn();
  const onDismiss = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("explains the full cart data that will be discarded and keeps clearing explicit", async () => {
    const screen = await render(
      <ClearCartConfirmationDialog
        onConfirm={onConfirm}
        onDismiss={onDismiss}
        visible
      />,
    );

    expect(
      screen.getByText(
        "Every item, quantity, payment allocation, batch or serial selection, discount, and note in this cart will be removed.",
      ),
    ).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("Cancel clear cart"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Confirm clear cart"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
