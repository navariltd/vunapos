import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      onSurface: "#111111",
      onSurfaceMuted: "#666666",
      primary: "#16794c",
      surface: "#ffffff",
    },
  }),
}));

import { PosCloseShiftScreen } from "@/features/pos/screens/PosCloseShiftScreen";

describe("PosCloseShiftScreen", () => {
  const onBackToPos = jest.fn();

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => cleanup());

  it("waits for the active POS Profile before preparing shift closing", async () => {
    const screen = await render(
      <PosCloseShiftScreen onBackToPos={onBackToPos} />,
    );

    expect(
      screen.getByText("Loading POS profile for shift closing…"),
    ).toBeTruthy();
  });

  it("opens the Close Shift workspace and returns to POS", async () => {
    const screen = await render(
      <PosCloseShiftScreen onBackToPos={onBackToPos} posProfile="POS-001" />,
    );

    expect(screen.getByText("Close POS Shift")).toBeTruthy();
    expect(
      screen.getByText("Reconcile the till and close POS-001."),
    ).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Back to POS" }));

    expect(onBackToPos).toHaveBeenCalledTimes(1);
  });
});
