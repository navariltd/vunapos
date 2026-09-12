import { cleanup, fireEvent, render } from "@testing-library/react-native";

const mockUseNetworkStatus = jest.fn();

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

import { PosPaymentsScreen } from "@/features/pos/screens/PosPaymentsScreen";

describe("PosPaymentsScreen", () => {
  const onBackToPos = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("shows only payment workflows enabled by the POS Profile", async () => {
    const screen = await render(
      <PosPaymentsScreen
        allowHistory
        allowReconciliation={false}
        allowReceive
        onBackToPos={onBackToPos}
      />,
    );

    expect(screen.getByRole("tab", { name: "Receive" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "History" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Reconcile" })).toBeNull();
    expect(
      screen.getByRole("tab", { name: "Receive" }).props.accessibilityState,
    ).toEqual({ selected: true });

    await fireEvent.press(screen.getByRole("tab", { name: "History" }));

    expect(
      screen.getByRole("tab", { name: "History" }).props.accessibilityState,
    ).toEqual({ selected: true });
    expect(screen.getByText("This workspace is ready. Its history workflow will be added next.")).toBeTruthy();
  });

  it("explains when all payment operations are disabled", async () => {
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation={false}
        allowReceive={false}
        onBackToPos={onBackToPos}
      />,
    );

    expect(screen.getByText("Payments disabled")).toBeTruthy();
    expect(
      screen.getByText(
        "All customer payment operations are disabled for this POS Profile.",
      ),
    ).toBeTruthy();
  });

  it("shows the online-only warning and returns to POS", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation={false}
        allowReceive
        onBackToPos={onBackToPos}
      />,
    );

    expect(
      screen.getByText("Payments require a connection. Reconnect before continuing."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to POS" }));
    expect(onBackToPos).toHaveBeenCalledTimes(1);
  });
});
