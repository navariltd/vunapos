import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockUsePosClosingPreview = jest.fn();
jest.mock("@/features/pos/hooks/usePosClosingPreview", () => ({
  usePosClosingPreview: (...args: unknown[]) =>
    mockUsePosClosingPreview(...args),
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      error: "#cc2929",
      errorSurface: "#fff0f0",
      onError: "#941f1f",
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUsePosClosingPreview.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
  });
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

  it("shows the fresh server closing preview and refreshes it", async () => {
    const reload = jest.fn();
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payments: [],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosCloseShiftScreen
        currency="KES"
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    expect(mockUsePosClosingPreview).toHaveBeenCalledWith("POS-001");
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("KES 500.00")).toBeTruthy();
    expect(screen.getByText("KES 580.00")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Refresh shift totals" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("blocks the workflow while offline and explains the connection requirement", async () => {
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "offline" });
    const screen = await render(
      <PosCloseShiftScreen onBackToPos={onBackToPos} posProfile="POS-001" />,
    );

    expect(
      screen.getByText("Reconnect to the server before closing this shift."),
    ).toBeTruthy();
  });

  it("shows a preview error and allows the cashier to retry", async () => {
    const reload = jest.fn();
    mockUsePosClosingPreview.mockReturnValue({
      data: null,
      error: "No open POS session was found.",
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosCloseShiftScreen onBackToPos={onBackToPos} posProfile="POS-001" />,
    );

    expect(screen.getByText("No open POS session was found.")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry closing preview" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
