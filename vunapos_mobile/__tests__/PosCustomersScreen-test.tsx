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

import { PosCustomersScreen } from "@/features/pos/screens/PosCustomersScreen";

describe("PosCustomersScreen", () => {
  afterEach(async () => cleanup());

  it("waits for the active POS Profile before exposing customers", async () => {
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled={false}
        onBackToPos={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Loading POS Profile for customers…"),
    ).toBeTruthy();
  });

  it("shows the customer-management disabled state and returns to POS", async () => {
    const onBackToPos = jest.fn();
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled={false}
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Customer management disabled")).toBeTruthy();
    expect(
      screen.getByText(
        "Customer management is disabled for this POS Profile.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to POS" }));
    expect(onBackToPos).toHaveBeenCalledTimes(1);
  });

  it("opens the Customer tab shell when the profile permits management", async () => {
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled
        onBackToPos={jest.fn()}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Customers")).toBeTruthy();
    expect(screen.getByText("Customer directory")).toBeTruthy();
  });
});
