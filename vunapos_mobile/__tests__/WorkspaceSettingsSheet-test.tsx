import { cleanup, fireEvent, render } from "@testing-library/react-native";

const mockSetPreference = jest.fn();

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 24, left: 0, right: 0, top: 0 }),
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#f8f8f8",
      border: "#c7c7c7",
      borderSubtle: "#ededed",
      disabled: "#a3a3a3",
      error: "#cc2929",
      errorSurface: "#fff0f0",
      onError: "#941f1f",
      onPrimary: "#ffffff",
      onSurface: "#171717",
      onSurfaceMuted: "#525252",
      primary: "#16794c",
      scrim: "rgba(23, 23, 23, 0.48)",
      success: "#16794c",
      surface: "#ffffff",
      surfaceContainer: "#f3f3f3",
      surfaceContainerHigh: "#e9e9e9",
    },
    preference: "system",
    setPreference: mockSetPreference,
  }),
}));

import { WorkspaceSettingsSheet } from "@/features/shell/components/WorkspaceSettingsSheet";

describe("WorkspaceSettingsSheet", () => {
  const onClose = jest.fn();
  const onOrderTypeChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await cleanup();
  });

  it("offers sale mode and appearance preferences from one compact workspace menu", async () => {
    const screen = await render(
      <WorkspaceSettingsSheet
        onClose={onClose}
        onOrderTypeChange={onOrderTypeChange}
        orderType="Invoice"
        visible
      />,
    );

    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(
      screen.getByRole("radio", { name: "Invoice" }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(
      screen.getByRole("radio", { name: "System" }).props.accessibilityState,
    ).toEqual({ selected: true });
  });

  it("changes sale mode and appearance without navigating away from the POS", async () => {
    const screen = await render(
      <WorkspaceSettingsSheet
        onClose={onClose}
        onOrderTypeChange={onOrderTypeChange}
        orderType="Invoice"
        visible
      />,
    );

    await fireEvent.press(screen.getByRole("radio", { name: "Order" }));
    await fireEvent.press(screen.getByRole("radio", { name: "Dark" }));

    expect(onOrderTypeChange).toHaveBeenCalledWith("Order");
    expect(mockSetPreference).toHaveBeenCalledWith("dark");
  });

  it("does not render its modal content when closed", async () => {
    const screen = await render(
      <WorkspaceSettingsSheet
        onClose={onClose}
        onOrderTypeChange={onOrderTypeChange}
        orderType="Invoice"
        visible={false}
      />,
    );

    expect(screen.queryByText("Workspace")).toBeNull();
  });
});
