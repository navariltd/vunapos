import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

const mockOpen = jest.fn();
const mockClearError = jest.fn();

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      error: "#cc0000",
      onPrimary: "#ffffff",
      onSurface: "#111111",
      onSurfaceMuted: "#666666",
      primary: "#008080",
      surface: "#ffffff",
      surfaceContainer: "#f5f5f5",
    },
  }),
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

jest.mock("@/features/pos/hooks/useOpenPosShift", () => ({
  useOpenPosShift: () => ({
    clearError: mockClearError,
    error: null,
    isOpening: false,
    open: mockOpen,
  }),
}));

import { PosSessionGateScreen } from "@/features/pos/screens/PosSessionGateScreen";

describe("PosSessionGateScreen", () => {
  afterEach(async () => {
    jest.clearAllMocks();
    await cleanup();
  });

  it("requires opening balances for the server-selected POS profile", async () => {
    mockOpen.mockResolvedValue({
      name: "POS-OPEN-001",
      pos_profile: "POS-001",
      success: true,
    });
    const onShiftOpened = jest.fn();
    const screen = await render(
      <PosSessionGateScreen
        currency="KES"
        onShiftOpened={onShiftOpened}
        paymentModes={[
          { mode_of_payment: "Cash" },
          { mode_of_payment: "Card" },
        ]}
        posProfile="POS-001"
        session={{
          has_opening_entry: false,
          opening_entry: null,
          ready: false,
          status: "OPENING_REQUIRED",
        }}
      />,
    );

    expect(screen.getAllByText("Start POS shift")).toHaveLength(2);
    const cashInput = screen.getByLabelText("Cash opening balance");
    expect(cashInput).toHaveProp("value", "0");
    await fireEvent(cashInput, "focus");
    expect(cashInput).toHaveProp("value", "");
    await fireEvent.changeText(
      cashInput,
      "1200.50",
    );
    await fireEvent.press(screen.getByLabelText("Start POS shift"));

    await waitFor(() =>
      expect(mockOpen).toHaveBeenCalledWith({
        openingBalances: [
          { mode_of_payment: "Cash", opening_amount: 1200.5 },
          { mode_of_payment: "Card", opening_amount: 0 },
        ],
        posProfile: "POS-001",
      }),
    );
    await waitFor(() =>
      expect(onShiftOpened).toHaveBeenCalledWith(
        expect.objectContaining({ name: "POS-OPEN-001" }),
      ),
    );
  });

  it("does not submit an invalid opening balance", async () => {
    const screen = await render(
      <PosSessionGateScreen
        paymentModes={[{ mode_of_payment: "Cash" }]}
        posProfile="POS-001"
        session={{
          has_opening_entry: false,
          ready: false,
          status: "OPENING_REQUIRED",
        }}
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText("Cash opening balance"),
      "-2",
    );
    await fireEvent.press(screen.getByLabelText("Start POS shift"));

    expect(mockOpen).not.toHaveBeenCalled();
    expect(
      screen.getByText("Enter a valid opening balance for Cash."),
    ).toBeTruthy();
  });
});
