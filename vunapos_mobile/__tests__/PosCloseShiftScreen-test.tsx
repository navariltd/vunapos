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

const mockUseClosePosShift = jest.fn();
jest.mock("@/features/pos/hooks/useClosePosShift", () => ({
  useClosePosShift: () => mockUseClosePosShift(),
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
    mockUseClosePosShift.mockReturnValue({
      clearError: jest.fn(),
      close: jest.fn(),
      error: null,
      isClosing: false,
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

  it("shows server-calculated shift payment activity when the preview supplies it", async () => {
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payment_activity: {
          cash_received: 340,
          credit_outstanding: 80,
          credit_sales: 100,
          customer_advances: 30,
          outstanding_invoice_payments: 40,
          reconciled_existing_credits: 10,
          sales_collected: 270,
        },
        payments: [],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCloseShiftScreen
        currency="KES"
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Shift payment activity")).toBeTruthy();
    expect(
      screen.getByText(
        "Credit sales are reported as sales, but only their deposits are included in cash received. Reconciled credits are allocations only.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Checkout collections")).toBeTruthy();
    expect(screen.getByText("Credit sales")).toBeTruthy();
    expect(screen.getByText("Credit outstanding")).toBeTruthy();
    expect(screen.getByText("Old invoice payments")).toBeTruthy();
    expect(screen.getByText("Customer advances")).toBeTruthy();
    expect(screen.getByText("Credits reconciled")).toBeTruthy();
    expect(screen.getByText("Cash received")).toBeTruthy();
    expect(screen.getByText("KES 270.00")).toBeTruthy();
    expect(screen.getByText("KES 340.00")).toBeTruthy();
  });

  it("pre-fills each payment count and calculates its live difference", async () => {
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payments: [
          {
            closing_amount: 100,
            difference: 0,
            expected_amount: 100,
            mode_of_payment: "Cash",
            opening_amount: 0,
          },
          {
            closing_amount: 0,
            difference: 0,
            expected_amount: 0,
            mode_of_payment: "Card",
            opening_amount: 0,
          },
        ],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCloseShiftScreen
        currency="KES"
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Payment reconciliation")).toBeTruthy();
    expect(screen.getByLabelText("Counted amount Cash").props.value).toBe(
      "100",
    );
    expect(screen.getByLabelText("Counted amount Card").props.value).toBe("0");
    expect(screen.getAllByText("Difference: KES 0.00")).toHaveLength(2);

    await fireEvent.changeText(
      screen.getByLabelText("Counted amount Cash"),
      "80.5",
    );

    expect(screen.getByLabelText("Counted amount Cash").props.value).toBe(
      "80.5",
    );
    expect(screen.getByText("Difference: -KES 19.50")).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText("Counted amount Cash"),
      "1200.50",
    );
    expect(screen.getByLabelText("Counted amount Cash").props.value).toBe(
      "1,200.50",
    );
    expect(screen.getByText("Difference: KES 1,100.50")).toBeTruthy();
  });

  it("requires a valid non-negative count before showing the confirmation review", async () => {
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payments: [
          {
            closing_amount: 100,
            difference: 0,
            expected_amount: 100,
            mode_of_payment: "Cash",
            opening_amount: 0,
          },
        ],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCloseShiftScreen
        currency="KES"
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText("Counted amount Cash"),
      "",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Review shift counts" }),
    );
    expect(screen.getByText("Enter a counted amount for Cash.")).toBeTruthy();
    expect(
      screen.queryByText(
        "Confirm the totals below before closing this POS shift.",
      ),
    ).toBeNull();

    await fireEvent.changeText(
      screen.getByLabelText("Counted amount Cash"),
      "-5",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Review shift counts" }),
    );
    expect(
      screen.getByText("Enter a valid counted amount for Cash."),
    ).toBeTruthy();
  });

  it("opens a themed review with the validated totals and counts", async () => {
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payments: [
          {
            closing_amount: 100,
            difference: 0,
            expected_amount: 100,
            mode_of_payment: "Cash",
            opening_amount: 0,
          },
        ],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCloseShiftScreen
        currency="KES"
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText("Counted amount Cash"),
      "90",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Review shift counts" }),
    );

    expect(
      screen.getByText(
        "Confirm the totals below before closing this POS shift.",
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("KES 580.00")).toHaveLength(2);
    expect(screen.getByText(/\(−?KES|\(-KES/)).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Back to shift counts" }),
    );
    expect(screen.queryByText("Counted amounts")).toBeNull();
  });

  it("submits reviewed balances and hands the closed session to the workspace", async () => {
    const close = jest.fn().mockResolvedValue({
      name: "POS-CLOSE-001",
      session: {
        has_opening_entry: false,
        opening_entry: null,
        ready: false,
        status: "OPENING_REQUIRED",
      },
    });
    const onShiftClosed = jest.fn();
    mockUseClosePosShift.mockReturnValue({
      clearError: jest.fn(),
      close,
      error: null,
      isClosing: false,
    });
    mockUsePosClosingPreview.mockReturnValue({
      data: {
        cashier: "cashier@example.com",
        grand_total: 580,
        invoice_count: 2,
        net_total: 500,
        opening_entry: "POS-OPEN-001",
        payments: [
          {
            closing_amount: 100,
            difference: 0,
            expected_amount: 100,
            mode_of_payment: "Cash",
            opening_amount: 0,
          },
        ],
        period_end_date: "2026-09-13 10:00:00",
        period_start_date: "2026-09-13 08:00:00",
        pos_profile: "POS-001",
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCloseShiftScreen
        onBackToPos={onBackToPos}
        onShiftClosed={onShiftClosed}
        posProfile="POS-001"
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Review shift counts" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Close POS Shift" }),
    );

    expect(close).toHaveBeenCalledWith({
      closingBalances: [{ closing_amount: 100, mode_of_payment: "Cash" }],
      posProfile: "POS-001",
    });
    expect(onShiftClosed).toHaveBeenCalledWith({
      has_opening_entry: false,
      opening_entry: null,
      ready: false,
      status: "OPENING_REQUIRED",
    });
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
