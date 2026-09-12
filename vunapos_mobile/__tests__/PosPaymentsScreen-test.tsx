import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

const mockUseNetworkStatus = jest.fn();
const mockUsePosCustomerDetails = jest.fn();
const mockUsePosCustomerSearch = jest.fn();
const mockUsePosPaymentReconciliationAllocation = jest.fn();
const mockUsePosPaymentReconciliationCandidates = jest.fn();
const mockUsePosPaymentReconciliation = jest.fn();
const mockUseReceiveCustomerPayment = jest.fn();
const mockUseGatewayPayment = jest.fn();
const mockUseGatewayPaymentRealtime = jest.fn();

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

jest.mock("@/features/pos/hooks/usePosPaymentReconciliationCandidates", () => ({
  usePosPaymentReconciliationCandidates: (...args: unknown[]) =>
    mockUsePosPaymentReconciliationCandidates(...args),
}));

jest.mock("@/features/pos/hooks/usePosPaymentReconciliationAllocation", () => ({
  usePosPaymentReconciliationAllocation: () =>
    mockUsePosPaymentReconciliationAllocation(),
}));

jest.mock("@/features/pos/hooks/usePosPaymentReconciliation", () => ({
  usePosPaymentReconciliation: () => mockUsePosPaymentReconciliation(),
}));

jest.mock("@/features/pos/hooks/useReceiveInvoicePayment", () => ({
  useReceiveCustomerPayment: () => mockUseReceiveCustomerPayment(),
}));

jest.mock("@/features/pos/hooks/useGatewayPayment", () => ({
  useGatewayPayment: () => mockUseGatewayPayment(),
}));

jest.mock("@/features/pos/hooks/useGatewayPaymentRealtime", () => ({
  useGatewayPaymentRealtime: (onChange: unknown) =>
    mockUseGatewayPaymentRealtime(onChange),
}));

import { PosPaymentsScreen } from "@/features/pos/screens/PosPaymentsScreen";

describe("PosPaymentsScreen", () => {
  const onBackToPos = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseGatewayPaymentRealtime.mockImplementation(() => undefined);
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
    mockUsePosPaymentReconciliationCandidates.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosPaymentReconciliationAllocation.mockReturnValue({
      allocate: jest.fn(),
      clearError: jest.fn(),
      error: null,
      isAllocating: false,
    });
    mockUsePosPaymentReconciliation.mockReturnValue({
      clearError: jest.fn(),
      error: null,
      isReconciling: false,
      reconcile: jest.fn(),
    });
    mockUseReceiveCustomerPayment.mockReturnValue({
      error: null,
      isSubmitting: false,
      receive: jest.fn(),
    });
    mockUseGatewayPayment.mockReturnValue({
      attachC2B: jest.fn(),
      cancel: jest.fn(),
      clearError: jest.fn(),
      error: null,
      getStatus: jest.fn(),
      initiate: jest.fn(),
      isWorking: false,
      searchC2B: jest.fn(),
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

  it("loads server-authoritative reconciliation candidates for the selected customer", async () => {
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      rows: [
        {
          customer: "CUST-001",
          customerName: "Example customer",
          mobile: "+254700000000",
        },
        {
          customer: "CUST-002",
          customerName: "Another customer",
        },
      ],
    });
    mockUsePosPaymentReconciliationCandidates.mockReturnValue({
      data: {
        invoices: [
          {
            amount: 116,
            currency: "KES",
            name: "SINV-0001",
            outstanding_amount: 58,
            posting_date: "2026-09-12",
          },
        ],
        payments: [
          {
            amount: 58,
            currency: "KES",
            name: "ACC-PAY-0001",
            posting_date: "2026-09-11",
          },
        ],
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation
        allowReceive={false}
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[]}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Reconcile payments")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Select reconciliation customer Example customer",
      }),
    );

    expect(mockUsePosPaymentReconciliationCandidates).toHaveBeenLastCalledWith(
      "CUST-001",
      "POS-001",
    );
    expect(screen.getByText("Unallocated payments")).toBeTruthy();
    expect(screen.getByText("Outstanding invoices")).toBeTruthy();
    expect(screen.getByText("ACC-PAY-0001")).toBeTruthy();
    expect(screen.getByText("SINV-0001")).toBeTruthy();
    expect(screen.getAllByText("KES 58.00")).toHaveLength(2);

    const payment = screen.getByRole("checkbox", {
      name: "Select payment ACC-PAY-0001",
    });
    const invoice = screen.getByRole("checkbox", {
      name: "Select invoice SINV-0001",
    });
    expect(payment.props.accessibilityState).toEqual({ checked: false });
    expect(invoice.props.accessibilityState).toEqual({ checked: false });

    await fireEvent.press(payment);
    await fireEvent.press(invoice);
    expect(
      screen.getByRole("checkbox", {
        name: "Select payment ACC-PAY-0001",
      }).props.accessibilityState,
    ).toEqual({ checked: true });
    expect(
      screen.getByRole("checkbox", { name: "Select invoice SINV-0001" }).props
        .accessibilityState,
    ).toEqual({ checked: true });

    await fireEvent.press(
      screen.getByRole("button", { name: "Change reconciliation customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Select reconciliation customer Another customer",
      }),
    );
    expect(mockUsePosPaymentReconciliationCandidates).toHaveBeenLastCalledWith(
      "CUST-002",
      "POS-001",
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Select payment ACC-PAY-0001",
      }).props.accessibilityState,
    ).toEqual({ checked: false });
  });

  it("previews the server allocation only after payment and invoice selections, then invalidates it", async () => {
    const allocate = jest.fn().mockResolvedValue([
      {
        allocated_amount: 58,
        currency: "KES",
        invoice: "SINV-0001",
        payment_entry: "ACC-PAY-0001",
      },
    ]);
    const reconcile = jest.fn().mockResolvedValue({
      allocated_amount: 58,
      allocations: [],
    });
    const reload = jest.fn();
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      rows: [{ customer: "CUST-001", customerName: "Example customer" }],
    });
    mockUsePosPaymentReconciliationCandidates.mockReturnValue({
      data: {
        invoices: [
          {
            amount: 116,
            currency: "KES",
            name: "SINV-0001",
            outstanding_amount: 58,
            posting_date: "2026-09-12",
          },
        ],
        payments: [
          {
            amount: 58,
            currency: "KES",
            name: "ACC-PAY-0001",
            posting_date: "2026-09-11",
          },
        ],
      },
      error: null,
      isLoading: false,
      reload,
    });
    mockUsePosPaymentReconciliationAllocation.mockReturnValue({
      allocate,
      clearError: jest.fn(),
      error: null,
      isAllocating: false,
    });
    mockUsePosPaymentReconciliation.mockReturnValue({
      clearError: jest.fn(),
      error: null,
      isReconciling: false,
      reconcile,
    });
    const screen = await render(
      <PosPaymentsScreen
        allowHistory={false}
        allowReconciliation
        allowReceive={false}
        currency="KES"
        currencyPrecision={2}
        onBackToPos={onBackToPos}
        paymentModes={[]}
        posProfile="POS-001"
      />,
    );

    await fireEvent.press(
      screen.getByRole("button", {
        name: "Select reconciliation customer Example customer",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Preview payment allocation" }).props
        .accessibilityState,
    ).toEqual({ disabled: true });

    await fireEvent.press(
      screen.getByRole("checkbox", { name: "Select payment ACC-PAY-0001" }),
    );
    await fireEvent.press(
      screen.getByRole("checkbox", { name: "Select invoice SINV-0001" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Preview payment allocation" }),
    );

    expect(allocate).toHaveBeenCalledWith({
      customer: "CUST-001",
      invoices: ["SINV-0001"],
      paymentEntries: ["ACC-PAY-0001"],
      posProfile: "POS-001",
    });
    expect(await screen.findByText("Allocation preview")).toBeTruthy();
    expect(screen.getAllByText("ACC-PAY-0001")).toHaveLength(2);

    await fireEvent.press(
      screen.getByRole("button", { name: "Reconcile selected payments" }),
    );
    expect(reconcile).toHaveBeenCalledWith({
      customer: "CUST-001",
      invoices: ["SINV-0001"],
      paymentEntries: ["ACC-PAY-0001"],
      posProfile: "POS-001",
    });
    expect(
      await screen.findByText("Reconciled KES 58.00 successfully."),
    ).toBeTruthy();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Allocation preview")).toBeNull();

    await fireEvent.press(
      screen.getByRole("checkbox", { name: "Select invoice SINV-0001" }),
    );
    expect(screen.queryByText("Allocation preview")).toBeNull();
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

  it("requires a verified gateway link before submitting a gateway payment", async () => {
    const initiate = jest.fn().mockResolvedValue({
      amount: 58,
      mode_of_payment: "M-Pesa",
      name: "GPL-001",
      status: "Pending",
    });
    const receive = jest.fn().mockResolvedValue({ name: "ACC-PAY-0002" });
    let gatewayRealtimeHandler:
      ((payment: { name: string; status: string }) => void) | undefined;
    mockUseGatewayPayment.mockReturnValue({
      attachC2B: jest.fn(),
      cancel: jest.fn(),
      clearError: jest.fn(),
      error: null,
      getStatus: jest.fn(),
      initiate,
      isWorking: false,
      searchC2B: jest.fn(),
    });
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
          mobile: "0712345678",
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
      reload: jest.fn(),
    });
    mockUseGatewayPaymentRealtime.mockImplementation((handler) => {
      gatewayRealtimeHandler = handler as (payment: {
        name: string;
        status: string;
      }) => void;
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
          { mode_of_payment: "M-Pesa", payment_gateway: "M-Pesa" },
        ]}
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
      screen.getByRole("button", { name: "Send STK payment request" }),
    );

    await waitFor(() =>
      expect(initiate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 58,
          customer: "CUST-001",
          modeOfPayment: "M-Pesa",
          phoneNumber: "0712345678",
        }),
      ),
    );
    expect(
      screen.getByLabelText("Submit customer payment").props.accessibilityState,
    ).toEqual({ disabled: true });

    await act(async () => {
      gatewayRealtimeHandler?.({ name: "GPL-001", status: "Paid" });
    });
    await waitFor(() => expect(screen.getByText("Paid")).toBeTruthy());
    await fireEvent.press(
      screen.getByRole("button", { name: "Submit customer payment" }),
    );

    expect(receive).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 58,
        gatewayPaymentLink: "GPL-001",
        invoice: "SINV-0001",
        modeOfPayment: "M-Pesa",
      }),
    );
  });

  it("finds and attaches only an exact-amount C2B payment", async () => {
    const attachC2B = jest.fn().mockResolvedValue({
      amount: 58,
      mode_of_payment: "M-Pesa",
      name: "GPL-002",
      status: "Paid",
    });
    const searchC2B = jest.fn().mockResolvedValue([
      {
        amount: 58,
        currency: "KES",
        name: "C2B-001",
        party_name: "Example payer",
        transaction_id: "TXN-001",
      },
    ]);
    mockUseGatewayPayment.mockReturnValue({
      attachC2B,
      cancel: jest.fn(),
      clearError: jest.fn(),
      error: null,
      getStatus: jest.fn(),
      initiate: jest.fn(),
      isWorking: false,
      searchC2B,
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
      reload: jest.fn(),
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
          { mode_of_payment: "M-Pesa", payment_gateway: "M-Pesa" },
        ]}
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
      screen.getByRole("radio", { name: "Find C2B payment" }),
    );
    await fireEvent.changeText(
      screen.getByLabelText("Search C2B payments"),
      "TXN-001",
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Search incoming C2B payments" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Attach C2B payment TXN-001" }),
      ).toBeTruthy(),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Attach C2B payment TXN-001" }),
    );

    expect(searchC2B).toHaveBeenCalledWith({
      currency: "KES",
      customer: "CUST-001",
      modeOfPayment: "M-Pesa",
      posProfile: "POS-001",
      query: "TXN-001",
    });
    expect(attachC2B).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 58,
        customer: "CUST-001",
        modeOfPayment: "M-Pesa",
        transactionReference: "TXN-001",
      }),
    );
    await waitFor(() => expect(screen.getByText("Paid")).toBeTruthy());
  });
});
