import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => ({ connectionStatus: "online" }),
}));

jest.mock("@/features/auth/AppSessionProvider", () => ({
  useAppSession: () => ({
    companyUrl: "https://vuna.example.com",
    sessionId: "sid-1",
  }),
}));

jest.mock("@/features/shell/components/AppShell", () => ({
  AppShell: ({
    children,
    onOrderTypeChange,
    onTabChange,
    orderType,
  }: {
    children: React.ReactNode;
    onOrderTypeChange: (orderType: "Invoice" | "Order") => void;
    onTabChange: (tab: "Home" | "Invoices" | "Customers") => void;
    orderType: "Invoice" | "Order";
  }) => {
    const { Pressable, Text, View } = require("react-native");

    return (
      <View>
        <Text>{`Current order type: ${orderType}`}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onOrderTypeChange(orderType === "Invoice" ? "Order" : "Invoice")
          }
        >
          <Text>Switch order type</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onTabChange("Invoices")}
        >
          <Text>Open invoices</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onTabChange("Customers")}
        >
          <Text>Open customers</Text>
        </Pressable>
        {children}
      </View>
    );
  },
}));

const mockCart = {
  add: jest.fn(),
  clear: jest.fn(() => true),
  error: null,
  isUpdating: false,
  itemCount: 0,
  items: [],
  refresh: jest.fn(),
  remove: jest.fn(async () => true),
  restoreHeldInvoice: jest.fn(async () => ({
    source: { doctype: "Sales Order", name: "SAL-ORD-001" },
  })),
  retry: jest.fn(),
  subtotal: 0,
  taxes: [],
  totals: {},
  updateQuantity: jest.fn(),
};

jest.mock("@/features/pos/hooks/usePosCart", () => ({
  usePosCart: () => mockCart,
}));

jest.mock("@/features/pos/hooks/useSalespersonPin", () => ({
  useSalespersonPin: () => ({
    error: null,
    isVerifying: false,
    lock: jest.fn(),
    session: null,
    verify: jest.fn(),
  }),
}));

jest.mock("@/features/pos/hooks/useOpenPosShift", () => ({
  useOpenPosShift: () => ({
    clearError: jest.fn(),
    error: null,
    isOpening: false,
    open: jest.fn(async () => ({ name: "OPEN-001" })),
  }),
}));

jest.mock("@/features/pos/components/SalespersonPinLock", () => ({
  SalespersonPinLock: () => null,
}));

let mockSetConfigData: ((data: unknown) => void) | undefined;
let mockCheckoutVerificationKey: string | undefined;
let mockInitialSession: unknown = {
  has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN",
};
jest.mock("@/features/pos/hooks/usePosBootstrap", () => ({
  usePosBootstrapConfig: () => ({
    data: (() => {
      const { useState } = require("react");
      const [data, setData] = useState({
        payment_modes: [],
        pos_profile: { name: "POS-001" },
        pos_session: mockInitialSession,
      });
      mockSetConfigData = (next) => setData((current: { pos_session?: unknown }) => ({
        ...(next as Record<string, unknown>),
        pos_session: Object.prototype.hasOwnProperty.call(next, "pos_session")
          ? (next as { pos_session?: unknown }).pos_session
          : current.pos_session,
      }));
      return data;
    })(),
    error: null,
    isLoading: false,
    isRefreshing: false,
    isStale: false,
    lastUpdated: null,
    reload: jest.fn(),
  }),
}));

jest.mock("@/features/pos/screens/PosHomeScreen", () => ({
  PosHomeScreen: ({
    onOpenCart,
    pricingContext,
  }: {
    onOpenCart: () => void;
    pricingContext?: { customer?: string };
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <>
        <Text>POS home</Text>
        <Text>{`Catalogue customer: ${pricingContext?.customer || "none"}`}</Text>
        <Pressable accessibilityRole="button" onPress={onOpenCart}>
          <Text>Open cart</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: { name: "POS-001" },
              pos_session: {
                has_opening_entry: false,
                ready: false,
                status: "OPENING_REQUIRED",
              },
            })
          }
        >
          <Text>Set closed shift session</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              default_customer: {
                customer: "WALK-IN",
                customer_name: "Walk-in customer",
                is_walkin: true,
              },
              payment_modes: [],
              pos_profile: { name: "POS-001" },
            })
          }
        >
          <Text>Set profile default customer</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: {
                default_order_type: "Sales Invoice",
                name: "POS-001",
              },
            })
          }
        >
          <Text>Set Invoice as POS default</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: {
                default_order_type: "Sales Order",
                name: "POS-001",
              },
            })
          }
        >
          <Text>Set Order as POS default</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: { allow_customer_management: true, name: "POS-001" },
            })
          }
        >
          <Text>Enable customer management</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: {
                allow_customer_management: false,
                name: "POS-001",
              },
            })
          }
        >
          <Text>Disable customer management</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosCustomersScreen", () => ({
  initialCustomerDirectoryViewState: {
    filters: { customerGroup: "", customerType: "", territory: "" },
    query: "",
    start: 0,
  },
  PosCustomersScreen: ({
    customerManagementEnabled,
    directoryState,
    onDirectoryStateChange,
    onOpenCustomer,
  }: {
    customerManagementEnabled: boolean;
    directoryState: {
      filters: {
        customerGroup: string;
        customerType: "" | "Company" | "Individual";
        territory: string;
      };
      query: string;
      start: number;
    };
    onDirectoryStateChange: (state: {
      filters: {
        customerGroup: string;
        customerType: "" | "Company" | "Individual";
        territory: string;
      };
      query: string;
      start: number;
    }) => void;
    onOpenCustomer: (customer: string) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <>
        <Text>
          {customerManagementEnabled
            ? "Customers enabled"
            : "Customers disabled"}
        </Text>
        <Text>{`Customer query: ${directoryState.query}`}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onDirectoryStateChange({
              ...directoryState,
              query: "ABC",
              start: 0,
            })
          }
        >
          <Text>Search customers</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenCustomer("CUST-001")}
        >
          <Text>Open customer</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosCustomerDetailsScreen", () => ({
  PosCustomerDetailsScreen: ({
    customer,
    onBack,
    onOpenInvoice,
    onOpenPaymentEntry,
    onReceivePayment,
    onStartSale,
  }: {
    customer: string;
    onBack: () => void;
    onOpenInvoice: (invoice: { doctype?: string; name: string }) => void;
    onOpenPaymentEntry: (payment: {
      name: string;
      received_amount: number;
      unallocated_amount: number;
    }) => void;
    onReceivePayment: (customer: {
      customer: string;
      customerName: string;
    }) => void;
    onStartSale: (customer: { customer: string; customerName: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    const selectedCustomer = { customer, customerName: "Directory customer" };
    return (
      <>
        <Text>{`Customer details: ${customer}`}</Text>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text>Back to customers</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onStartSale(selectedCustomer)}
        >
          <Text>Start customer sale</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onReceivePayment(selectedCustomer)}
        >
          <Text>Receive customer payment</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onOpenInvoice({ doctype: "Sales Invoice", name: "ACC-SINV-001" })
          }
        >
          <Text>Open customer invoice</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onOpenPaymentEntry({
              name: "ACC-PAY-001",
              received_amount: 100,
              unallocated_amount: 0,
            })
          }
        >
          <Text>Open customer payment</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosPaymentsScreen", () => ({
  PosPaymentsScreen: ({
    initialReceiveCustomer,
  }: {
    initialReceiveCustomer?: { customer: string };
  }) => {
    const { Text } = require("react-native");
    return (
      <Text>{`Payment customer: ${initialReceiveCustomer?.customer || "none"}`}</Text>
    );
  },
}));

jest.mock("@/features/pos/screens/PosCartScreen", () => ({
  PosCartScreen: ({
    onCheckout,
    onClear,
    onRemove,
    onSelectShippingAddress,
    saleCustomer,
    shippingAddressName,
  }: {
    onCheckout: () => void;
    onClear: () => boolean;
    onRemove: (itemCode: string) => Promise<void>;
    onSelectShippingAddress: (addressName: string) => void;
    saleCustomer: { customerName: string } | null;
    shippingAddressName: string;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <>
        <Text>
          {saleCustomer
            ? `Cart customer: ${saleCustomer.customerName}`
            : "Cart has no customer"}
        </Text>
        <Pressable accessibilityRole="button" onPress={onClear}>
          <Text>Clear cart</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onRemove("ITEM-001")}
        >
          <Text>Remove last cart item</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCheckout}>
          <Text>Open checkout</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onSelectShippingAddress("ADDR-002")}
        >
          <Text>Select cart shipping address</Text>
        </Pressable>
        <Text>{`Cart shipping address: ${shippingAddressName || "none"}`}</Text>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosCheckoutScreen", () => ({
  PosCheckoutScreen: ({
    bootstrapData,
    onComplete,
    shippingAddressName,
    transactionReady,
    sessionVerificationKey,
  }: {
    bootstrapData?: { payment_modes?: { mode_of_payment: string }[] } | null;
    onComplete: (result: { doctype: string; name: string }) => void;
    shippingAddressName?: string;
    transactionReady?: boolean;
    sessionVerificationKey?: string;
  }) => {
    const { useState } = require("react");
    const { Pressable, Text, TextInput, View } = require("react-native");
    const [note, setNote] = useState("");
    mockCheckoutVerificationKey = sessionVerificationKey;
    return (
      <View>
        <Text>{`Checkout modes: ${bootstrapData?.payment_modes?.map((mode) => mode.mode_of_payment).join(", ") || "none"}`}</Text>
        <Text>{`Checkout shipping address: ${shippingAddressName || "none"}`}</Text>
        <Text>{`Checkout ready: ${transactionReady ? "yes" : "no"}`}</Text>
        <TextInput accessibilityLabel="Checkout note" onChangeText={setNote} value={note} />
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            mockSetConfigData?.({
              payment_modes: [],
              pos_profile: { name: "POS-001", price_list: "Updated" },
            })
          }
        >
          <Text>Refresh profile during checkout</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onComplete({ doctype: "Sales Order", name: "SO-TEST-0001" })
          }
        >
          <Text>Complete test sale</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onComplete({ doctype: "Sales Invoice", name: "SINV-TEST-0001" })
          }
        >
          <Text>Complete test invoice</Text>
        </Pressable>
      </View>
    );
  },
}));

jest.mock("@/features/pos/screens/PosInvoicesScreen", () => ({
  PosInvoicesScreen: ({
    onOpenInvoice,
  }: {
    onOpenInvoice: (invoice: { name: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <>
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenInvoice({ name: "POS-INV-0001" })}
        >
          <Text>Open invoice</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosInvoiceDetailsScreen", () => ({
  PosInvoiceDetailsScreen: ({
    invoiceName,
    onBack,
    onEditDraft,
    onOpenPaymentEntry,
    onOpenReturn,
    onStartSale,
  }: {
    invoiceName: string;
    onBack: () => void;
    onEditDraft: (source: { doctype: string; name: string }) => Promise<void>;
    onOpenPaymentEntry: (
      paymentEntry: {
        allocated_amount: number;
        docstatus: number;
        name: string;
        received_amount: number;
        unallocated_amount: number;
      },
      currency: string,
    ) => void;
    onOpenReturn: (invoiceReturn: { name: string }) => void;
    onStartSale: (customer: { customer: string; customerName: string }) => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <>
        <Text>{`Invoice details: ${invoiceName}`}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onStartSale({
              customer: "CUST-001",
              customerName: "Example customer",
            })
          }
        >
          <Text>Start new sale</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            onOpenPaymentEntry(
              {
                allocated_amount: 150,
                docstatus: 1,
                name: "ACC-PAY-0001",
                received_amount: 150,
                unallocated_amount: 0,
              },
              "KES",
            )
          }
        >
          <Text>Open payment</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenReturn({ name: "POS-INV-RET-0001" })}
        >
          <Text>Open return</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onBack}>
          <Text>Back to previous invoice</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void onEditDraft({ doctype: "Sales Order", name: invoiceName })}
        >
          <Text>Edit draft</Text>
        </Pressable>
      </>
    );
  },
}));

jest.mock("@/features/pos/screens/PosPaymentEntryDetailsScreen", () => ({
  PosPaymentEntryDetailsScreen: ({
    onBack,
    paymentEntry,
  }: {
    onBack: () => void;
    paymentEntry: { name: string };
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text>{`Payment details: ${paymentEntry.name}`}</Text>
      </Pressable>
    );
  },
}));

import { PosWorkspaceScreen } from "@/features/pos/screens/PosWorkspaceScreen";

describe("PosWorkspaceScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitialSession = {
      has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN",
    };
    mockCart.itemCount = 0;
    mockCart.clear.mockReturnValue(true);
    mockCart.remove.mockResolvedValue(true);
    mockCart.restoreHeldInvoice.mockResolvedValue({
      source: { doctype: "Sales Order", name: "SAL-ORD-001" },
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("does not render a redundant back-to-POS action in invoice history", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    expect(screen.getByText("POS home")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    expect(screen.queryByRole("button", { name: "Back to POS" })).toBeNull();
  });

  it("starts a fresh POS sale with the invoice customer selected", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Start new sale" }),
    );

    expect(screen.getByText("POS home")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    expect(screen.getByText("Cart customer: Example customer")).toBeTruthy();
  });

  it("carries the cart shipping address into checkout without a second selection", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Select cart shipping address" }),
    );
    expect(screen.getByText("Cart shipping address: ADDR-002")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Open checkout" }));
    expect(screen.getByText("Checkout shipping address: ADDR-002")).toBeTruthy();
  });

  it("returns to the POS Profile default customer when a cart is cleared", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Set profile default customer" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Catalogue customer: WALK-IN")).toBeTruthy(),
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Start new sale" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    expect(screen.getByText("Cart customer: Example customer")).toBeTruthy();

    await fireEvent.press(screen.getByRole("button", { name: "Clear cart" }));
    expect(screen.getByText("Cart customer: Walk-in customer")).toBeTruthy();
  });

  it("keeps an active checkout mounted while the shared profile snapshot changes", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open checkout" }));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Deliver tomorrow");

    await fireEvent.press(
      screen.getByRole("button", { name: "Refresh profile during checkout" }),
    );

    expect(screen.getByLabelText("Checkout note").props.value).toBe("Deliver tomorrow");
    expect(screen.queryByText("Preparing your POS settings…")).toBeNull();
    expect(screen.queryByText("Restoring your POS…")).toBeNull();
  });

  it("keeps a restored Sales Order as an Order even when mode switching is disabled", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Set Invoice as POS default" }));
    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [],
        pos_profile: {
          allow_order_type_change: false,
          default_order_type: "Sales Invoice",
          name: "POS-001",
        },
      });
    });
    await fireEvent.press(screen.getByRole("button", { name: "Open invoices" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(screen.getByRole("button", { name: "Edit draft" }));
    await waitFor(() => expect(screen.getByText("Current order type: Order")).toBeTruthy());
  });

  it("returns to the POS Profile default customer after the last cart item is removed", async () => {
    mockCart.itemCount = 1;
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Set profile default customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Start new sale" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));

    await fireEvent.press(
      screen.getByRole("button", { name: "Remove last cart item" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Cart customer: Walk-in customer")).toBeTruthy(),
    );
  });

  it("returns to the POS Profile default customer after completing a sale", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Set profile default customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Start new sale" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open checkout" }));
    mockCart.clear.mockClear();
    await fireEvent.press(
      screen.getByRole("button", { name: "Complete test sale" }),
    );
    expect(mockCart.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText("POS home")).toBeTruthy();
    expect(screen.queryByText("Invoice details")).toBeNull();
    expect(screen.getByText("Catalogue customer: WALK-IN")).toBeTruthy();
  });

  it("returns Home and clears the cart after an invoice completes", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open checkout" }));
    mockCart.clear.mockClear();

    await fireEvent.press(
      screen.getByRole("button", { name: "Complete test invoice" }),
    );

    expect(mockCart.clear).toHaveBeenCalledTimes(1);
    expect(screen.getByText("POS home")).toBeTruthy();
    expect(screen.queryByText("Invoice details")).toBeNull();
  });

  it("resets an Order override to the Invoice POS default after submission", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Set Invoice as POS default" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Current order type: Invoice")).toBeTruthy(),
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Switch order type" }),
    );
    expect(screen.getByText("Current order type: Order")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Open checkout" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Complete test sale" }),
    );

    expect(screen.getByText("Current order type: Invoice")).toBeTruthy();
  });

  it("resets an Invoice override to the Order POS default after submission", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(
      screen.getByRole("button", { name: "Set Order as POS default" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Current order type: Order")).toBeTruthy(),
    );

    await fireEvent.press(
      screen.getByRole("button", { name: "Switch order type" }),
    );
    expect(screen.getByText("Current order type: Invoice")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open cart" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Open checkout" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Complete test sale" }),
    );

    expect(screen.getByText("Current order type: Order")).toBeTruthy();
  });

  it("opens a linked payment and returns to the invoice", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open payment" }));

    expect(screen.getByText("Payment details: ACC-PAY-0001")).toBeTruthy();
    await fireEvent.press(screen.getByText("Payment details: ACC-PAY-0001"));
    expect(screen.getByRole("button", { name: "Start new sale" })).toBeTruthy();
  });

  it("opens a linked credit note and returns to the original invoice", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Open invoices" }),
    );
    await fireEvent.press(screen.getByRole("button", { name: "Open invoice" }));
    await fireEvent.press(screen.getByRole("button", { name: "Open return" }));
    await fireEvent.press(
      screen.getByRole("button", { name: "Back to previous invoice" }),
    );

    expect(screen.getByRole("button", { name: "Open return" })).toBeTruthy();
  });

  it("blocks the POS workspace when the current session is not ready for sales", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Set closed shift session" }),
    );

    await waitFor(() =>
      expect(screen.getAllByText("Start POS shift")).toHaveLength(2),
    );
  });

  it("does not expose a cold workspace before session readiness is known", async () => {
    mockInitialSession = null;
    const screen = await render(<PosWorkspaceScreen />);
    expect(screen.getByText("Checking POS session…")).toBeTruthy();
    expect(screen.queryByText("POS home")).toBeNull();
  });

  it("keeps an active checkout mounted when session verification temporarily becomes unknown", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await fireEvent.press(screen.getByText("Open cart"));
    await fireEvent.press(screen.getByText("Open checkout"));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Keep uncertain draft");
    await act(async () => mockSetConfigData?.({
      payment_modes: [], pos_profile: { name: "POS-001" }, pos_session: null,
    }));
    expect(screen.getByText("Checking POS session…")).toBeTruthy();
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Keep uncertain draft");
    expect(screen.getByText("Checkout ready: no")).toBeTruthy();
  });

  it("preserves checkout-local input when a session gate appears and later clears", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [],
        pos_profile: { name: "POS-001" },
        pos_session: { has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN" },
      });
    });
    await fireEvent.press(screen.getByText("Open cart"));
    await fireEvent.press(screen.getByText("Open checkout"));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Cashier draft");
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Cashier draft");

    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [],
        pos_profile: { name: "POS-001" },
        pos_session: { has_opening_entry: false, ready: false, status: "OPENING_REQUIRED" },
      });
    });
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Cashier draft");
    expect(screen.getAllByText("Start POS shift")).toHaveLength(2);
    expect(screen.getByText("Checkout ready: no")).toBeTruthy();

    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [],
        pos_profile: { name: "POS-001" },
        pos_session: { has_opening_entry: true, ready: true, status: "OPEN" },
      });
    });
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Cashier draft");
    expect(screen.getByText("Checkout ready: yes")).toBeTruthy();
  });

  it("keeps checkout mounted but unavailable while a shift is closing", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await act(async () => mockSetConfigData?.({
      payment_modes: [],
      pos_profile: { name: "POS-001" },
      pos_session: { has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN" },
    }));
    await fireEvent.press(screen.getByText("Open cart"));
    await fireEvent.press(screen.getByText("Open checkout"));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Unsubmitted order");

    await act(async () => mockSetConfigData?.({
      payment_modes: [],
      pos_profile: { name: "POS-001" },
      pos_session: {
        closing_entry: "CLOSE-001", has_opening_entry: true,
        opening_entry: "OPEN-001", ready: false, status: "CLOSING",
      },
    }));
    expect(screen.getByText("POS closing in progress")).toBeTruthy();
    expect(screen.getByText(/Your unfinished sale is preserved/)).toBeTruthy();
    expect(screen.getByText("Checkout ready: no")).toBeTruthy();
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Unsubmitted order");
  });

  it("keeps checkout fields while changing the preview key for a pricing configuration update", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    const posSession = {
      has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN",
    };
    await act(async () => mockSetConfigData?.({
      payment_modes: [], pos_profile: { name: "POS-001", price_list: "Retail" }, pos_session: posSession,
    }));
    await fireEvent.press(screen.getByText("Open cart"));
    await fireEvent.press(screen.getByText("Open checkout"));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Keep pricing note");
    const originalKey = mockCheckoutVerificationKey;

    await act(async () => mockSetConfigData?.({
      payment_modes: [], pos_profile: { name: "POS-001", price_list: "Wholesale" }, pos_session: posSession,
    }));
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Keep pricing note");
    expect(mockCheckoutVerificationKey).not.toBe(originalKey);
    expect(screen.getByText("Checkout ready: yes")).toBeTruthy();
  });

  it("updates checkout payment modes without an unnecessary pricing preview", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    const posSession = {
      has_opening_entry: true, opening_entry: "OPEN-001", ready: true, status: "OPEN",
    };
    await act(async () => mockSetConfigData?.({
      payment_modes: [{ mode_of_payment: "Cash" }],
      pos_profile: { name: "POS-001" }, pos_session: posSession,
    }));
    await fireEvent.press(screen.getByText("Open cart"));
    await fireEvent.press(screen.getByText("Open checkout"));
    await fireEvent.changeText(screen.getByLabelText("Checkout note"), "Keep payment note");
    const originalKey = mockCheckoutVerificationKey;

    await act(async () => mockSetConfigData?.({
      payment_modes: [{ mode_of_payment: "Cash" }, { mode_of_payment: "M-Pesa" }],
      pos_profile: { name: "POS-001" }, pos_session: posSession,
    }));
    expect(screen.getByLabelText("Checkout note").props.value).toBe("Keep payment note");
    expect(screen.getByText("Checkout modes: Cash, M-Pesa")).toBeTruthy();
    expect(mockCheckoutVerificationKey).toBe(originalKey);
    expect(screen.getByText("Checkout ready: yes")).toBeTruthy();
  });

  it("does not accept an open session belonging to another POS Profile", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await act(async () => mockSetConfigData?.({
      payment_modes: [],
      pos_profile: { name: "POS-001" },
      pos_session: {
        has_opening_entry: true, opening_entry: "OPEN-OTHER", pos_profile: "POS-002",
        ready: true, status: "OPEN",
      },
    }));
    expect(screen.getByText("POS session unavailable")).toBeTruthy();
    // The prior workspace remains mounted behind the blocking native gate.
    expect(screen.getByText("POS home")).toBeTruthy();
  });

  it("does not carry an optimistic opened shift into another POS Profile", async () => {
    const screen = await render(<PosWorkspaceScreen />);
    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [{ mode_of_payment: "Cash" }],
        pos_profile: { name: "POS-001" },
        pos_session: { has_opening_entry: false, ready: false, status: "OPENING_REQUIRED" },
      });
    });
    await fireEvent.press(screen.getByLabelText("Start POS shift"));
    await waitFor(() => expect(screen.getByText("POS home")).toBeTruthy());

    await act(async () => {
      mockSetConfigData?.({
        payment_modes: [{ mode_of_payment: "Cash" }],
        pos_profile: { name: "POS-002" },
        pos_session: { has_opening_entry: false, ready: false, status: "OPENING_REQUIRED" },
      });
    });
    expect(screen.getByLabelText("Start POS shift")).toBeTruthy();
  });

  it("opens the Customer tab only after the POS Profile enables customer management", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    expect(screen.getByText("Customers enabled")).toBeTruthy();
  });

  it("keeps a reached Customer tab in its disabled state when the profile denies management", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Disable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    expect(screen.getByText("Customers disabled")).toBeTruthy();
  });

  it("returns to the Customer directory with its current view state after opening a customer", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Search customers" }),
    );
    expect(screen.getByText("Customer query: ABC")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer" }),
    );
    expect(screen.getByText("Customer details: CUST-001")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Back to customers" }),
    );

    expect(screen.getByText("Customer query: ABC")).toBeTruthy();
  });

  it("starts a fresh customer sale with the customer-aware catalogue context", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Start customer sale" }),
    );

    expect(screen.getByText("POS home")).toBeTruthy();
    expect(screen.getByText("Catalogue customer: CUST-001")).toBeTruthy();
  });

  it("opens Receive payment with the selected directory customer", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Receive customer payment" }),
    );

    expect(screen.getByText("Payment customer: CUST-001")).toBeTruthy();
  });

  it("opens a customer invoice and returns to the same customer detail", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer invoice" }),
    );
    expect(screen.getByText("Invoice details: ACC-SINV-001")).toBeTruthy();

    await fireEvent.press(
      screen.getByRole("button", { name: "Back to previous invoice" }),
    );
    expect(screen.getByText("Customer details: CUST-001")).toBeTruthy();
  });

  it("opens a customer payment and returns to the same customer detail", async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(
      screen.getByRole("button", { name: "Enable customer management" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customers" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Open customer payment" }),
    );
    expect(screen.getByText("Payment details: ACC-PAY-001")).toBeTruthy();

    await fireEvent.press(screen.getByText("Payment details: ACC-PAY-001"));
    expect(screen.getByText("Customer details: CUST-001")).toBeTruthy();
  });
});
