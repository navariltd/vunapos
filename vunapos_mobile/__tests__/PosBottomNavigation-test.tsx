import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      border: "#c7c7c7",
      onPrimary: "#ffffff",
      onSurfaceMuted: "#525252",
      primary: "#16794c",
      surface: "#ffffff",
    },
  }),
}));

import { PosBottomNavigation } from "@/features/pos/components/PosBottomNavigation";

describe("PosBottomNavigation", () => {
  const onTabChange = jest.fn();

  beforeEach(() => jest.clearAllMocks());
  afterEach(async () => cleanup());

  it("keeps Payments unavailable when customer payments are disabled", async () => {
    const screen = await render(
      <PosBottomNavigation
        activeTab="Home"
        onTabChange={onTabChange}
        paymentsEnabled={false}
      />,
    );

    expect(screen.getByLabelText("Payments").props.accessibilityState).toEqual({
      disabled: true,
    });
  });

  it("opens Payments when customer payments are enabled", async () => {
    const screen = await render(
      <PosBottomNavigation
        activeTab="Home"
        onTabChange={onTabChange}
        paymentsEnabled
      />,
    );

    await fireEvent.press(screen.getByRole("tab", { name: "Payments" }));

    expect(onTabChange).toHaveBeenCalledWith("Payments");
  });

  it("opens Close Shift", async () => {
    const screen = await render(
      <PosBottomNavigation
        activeTab="Home"
        onTabChange={onTabChange}
        paymentsEnabled={false}
      />,
    );

    await fireEvent.press(screen.getByRole("tab", { name: "Close Shift" }));

    expect(onTabChange).toHaveBeenCalledWith("Close Shift");
  });
});
