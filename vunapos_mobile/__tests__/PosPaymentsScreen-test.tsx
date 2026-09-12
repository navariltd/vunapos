import { cleanup, fireEvent, render } from "@testing-library/react-native";

const mockUseNetworkStatus = jest.fn();
const mockUsePosCustomerDetails = jest.fn();
const mockUsePosCustomerSearch = jest.fn();
const mockUseReceiveCustomerPayment = jest.fn();

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

jest.mock("@/features/pos/hooks/usePosCustomerDetails", () => ({
  usePosCustomerDetails: () => mockUsePosCustomerDetails(),
}));

jest.mock("@/features/pos/hooks/usePosCustomerSearch", () => ({
  usePosCustomerSearch: () => mockUsePosCustomerSearch(),
}));

jest.mock("@/features/pos/hooks/useReceiveInvoicePayment", () => ({
  useReceiveCustomerPayment: () => mockUseReceiveCustomerPayment(),
}));

import { PosPaymentsScreen } from "@/features/pos/screens/PosPaymentsScreen";

describe("PosPaymentsScreen", () => {
  const onBackToPos = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUsePosCustomerDetails.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      rows: [],
    });
    mockUseReceiveCustomerPayment.mockReturnValue({
      error: null,
      isSubmitting: false,
      receive: jest.fn(),
    });
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
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[]}
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
    expect(
      screen.getByText(
        "This workspace is ready. Its history workflow will be added next.",
      ),
    ).toBeTruthy();
  });

  it("explains when all payment operations are disabled", async () => {
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation={false}
        allowReceive={false}
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[]}
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
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[]}
      />,
    );

    expect(
      screen.getByText(
        "Payments require a connection. Reconnect before continuing.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to POS" }));
    expect(onBackToPos).toHaveBeenCalledTimes(1);
  });

  it("selects a customer, shows current outstanding invoices, and pre-fills the chosen invoice amount", async () => {
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      rows: [
        {
          customer: "CUST-001",
          customerName: "Example customer",
          mobile: "+254700000000",
        },
      ],
    });
    mockUsePosCustomerDetails.mockReturnValue({
      data: {
        invoices: [
          {
            currency: "KES",
            is_return: false,
            name: "SINV-0001",
            outstanding_amount: 58,
          },
          {
            currency: "KES",
            is_return: true,
            name: "SINV-RET-0001",
            outstanding_amount: 20,
          },
        ],
      },
      error: null,
      isLoading: false,
    });
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation={false}
        allowReceive
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[
          { default: true, mode_of_payment: "Cash" },
          { mode_of_payment: "Bank", requires_reference: true },
        ]}
        posProfile="POS-001"
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Select payment customer Example customer",
      }),
    );
    expect(screen.getByText("Customer advance")).toBeTruthy();
    expect(screen.getByText("SINV-0001")).toBeTruthy();
    expect(screen.queryByText("SINV-RET-0001")).toBeNull();

    await fireEvent.press(
      screen.getByRole("button", { name: "Apply payment to SINV-0001" }),
    );
    expect(screen.getByLabelText("Receive payment amount").props.value).toBe(
      "58",
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Apply as customer advance" }),
    );
    expect(screen.getByLabelText("Receive payment amount").props.value).toBe(
      "",
    );
    expect(
      screen.getByRole("radio", { name: "Payment mode Cash" }).props
        .accessibilityState,
    ).toEqual({ selected: true });

    await fireEvent.press(
      screen.getByRole("radio", { name: "Payment mode Bank" }),
    );
    expect(screen.getByLabelText("Payment reference number")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Choose payment reference date" }),
    ).toBeTruthy();

    await fireEvent.changeText(
      screen.getByLabelText("Receive payment amount"),
      "0",
    );
    expect(screen.getByText("Enter an amount greater than zero.")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Payment remarks"),
      "Cheque received at counter",
    );
    expect(screen.getByLabelText("Payment remarks").props.value).toBe(
      "Cheque received at counter",
    );
  });

  it("submits an invoice allocation and refreshes the customer balance after success", async () => {
    const receive = jest.fn().mockResolvedValue({ name: "ACC-PAY-0001" });
    const reload = jest.fn();
    mockUseReceiveCustomerPayment.mockReturnValue({
      error: null,
      isSubmitting: false,
      receive,
    });
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      rows: [
        {
          customer: "CUST-001",
          customerName: "Example customer",
        },
      ],
    });
    mockUsePosCustomerDetails.mockReturnValue({
      data: {
        invoices: [
          {
            currency: "KES",
            is_return: false,
            name: "SINV-0001",
            outstanding_amount: 58,
          },
        ],
      },
      error: null,
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation={false}
        allowReceive
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[{ default: true, mode_of_payment: "Cash" }]}
        posProfile="POS-001"
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Select payment customer Example customer",
      }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Apply payment to SINV-0001" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Submit customer payment" }),
    );

    expect(receive).toHaveBeenCalledWith({
      amount: 58,
      customer: "CUST-001",
      invoice: "SINV-0001",
      modeOfPayment: "Cash",
      posProfile: "POS-001",
      referenceDate: undefined,
      referenceNo: undefined,
      remarks: undefined,
    });
    expect(
      await screen.findByText(
        "Payment Entry ACC-PAY-0001 was submitted successfully.",
      ),
    ).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Receive payment amount").props.value).toBe(
      "",
    );
  });
});
