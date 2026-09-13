import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react-native";

jest.mock("react-native/Libraries/Lists/FlatList", () => {
  const React = require("react");
  const View = require("react-native/Libraries/Components/View/View").default;

  return {
    __esModule: true,
    default: ({
      data = [],
      ListEmptyComponent,
      ListFooterComponent,
      ListHeaderComponent,
      renderItem,
    }: {
      data?: unknown[];
      ListEmptyComponent?: unknown;
      ListFooterComponent?: unknown;
      ListHeaderComponent?: unknown;
      renderItem: ({ item }: { item: unknown }) => unknown;
    }) =>
      React.createElement(
        View,
        null,
        ListHeaderComponent,
        data.length
          ? data.map((item, index) =>
              React.createElement(
                React.Fragment,
                { key: index },
                renderItem({ item }),
              ),
            )
          : ListEmptyComponent,
        ListFooterComponent,
      ),
  };
});

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/hooks/usePosBootstrap", () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosInvoiceHistory", () => ({
  usePosInvoiceHistory: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosHeldInvoices", () => ({
  usePosHeldInvoices: jest.fn(),
}));

jest.mock("@/features/pos/components/PosInvoiceListItem", () => ({
  PosInvoiceListItem: ({
    invoice,
    onPress,
  }: {
    invoice: { invoiceNumber: string };
    onPress: () => void;
  }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityLabel={`Open ${invoice.invoiceNumber}`}
        onPress={onPress}
      >
        <Text>{invoice.invoiceNumber}</Text>
      </Pressable>
    );
  },
}));

jest.mock("@/features/pos/components/PosInvoiceFiltersSheet", () => ({
  PosInvoiceFiltersSheet: ({
    filters,
    onApply,
    onChange,
    onClear,
    visible,
  }: {
    filters: { currentShift: boolean; invoice: string };
    onApply: () => void;
    onChange: (
      field: "invoice" | "currentShift",
      value: string | boolean,
    ) => void;
    onClear: () => void;
    visible: boolean;
  }) => {
    const { Pressable, Text, View } = require("react-native");
    return visible ? (
      <View>
        <Text>Draft invoice: {filters.invoice || "none"}</Text>
        <Pressable
          accessibilityLabel="Set draft invoice"
          onPress={() => onChange("invoice", "SINV-0002")}
        >
          <Text>Set draft invoice</Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Disable current shift"
          onPress={() => onChange("currentShift", false)}
        >
          <Text>Disable current shift</Text>
        </Pressable>
        <Pressable accessibilityLabel="Apply draft filters" onPress={onApply}>
          <Text>Apply draft filters</Text>
        </Pressable>
        <Pressable accessibilityLabel="Clear draft filters" onPress={onClear}>
          <Text>Clear draft filters</Text>
        </Pressable>
      </View>
    ) : null;
  },
}));

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosHeldInvoices } from "@/features/pos/hooks/usePosHeldInvoices";
import { usePosInvoiceHistory } from "@/features/pos/hooks/usePosInvoiceHistory";
import { PosInvoicesScreen } from "@/features/pos/screens/PosInvoicesScreen";

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosHeldInvoices = jest.mocked(usePosHeldInvoices);
const mockUsePosInvoiceHistory = jest.mocked(usePosInvoiceHistory);
const onBackToPos = jest.fn();
const onOpenInvoice = jest.fn();
const onRestoreHeld = jest.fn();

const historyResult = {
  data: {
    has_more: true,
    invoices: [
      {
        currency: "KES",
        customer: "CUST-001",
        customer_name: "Example customer",
        doctype: "POS Invoice",
        grand_total: 100,
        is_return: false,
        name: "POS-INV-0001",
        outstanding_amount: 0,
        payments: [],
        posting_date: "2026-09-12",
        posting_time: "09:30:00",
        rounded_total: 100,
        status: "Paid",
        total_qty: 1,
        vunapos_credit_sale: 0,
      },
    ],
    summary: {
      credit_outstanding: 0,
      credit_sales: 0,
      gross_sales: 100,
      invoice_count: 1,
      outstanding: 0,
      returns: 0,
    },
  },
  error: null,
  isLoading: false,
};

describe("PosInvoicesScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [{ mode_of_payment: "Cash" }],
        pos_profile: {
          currency: "KES",
          currency_precision: 2,
          name: "POS-001",
        },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    } as unknown as ReturnType<typeof usePosBootstrap>);
    mockUsePosInvoiceHistory.mockReturnValue(
      historyResult as unknown as ReturnType<typeof usePosInvoiceHistory>,
    );
    mockUsePosHeldInvoices.mockReturnValue({
      data: [],
      error: null,
      isLoading: false,
      reload: jest.fn(),
    } as unknown as ReturnType<typeof usePosHeldInvoices>);
  });

  afterEach(async () => {
    await cleanup();
  });

  async function renderScreen() {
    return render(
      <PosInvoicesScreen
        onBackToPos={onBackToPos}
        onOpenInvoice={onOpenInvoice}
        onRestoreHeld={onRestoreHeld}
      />,
    );
  }

  it("starts with the current-shift invoice history and opens a selected invoice", async () => {
    const screen = await renderScreen();

    expect(mockUsePosInvoiceHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({
          currentShift: true,
          documentType: "Invoice",
        }),
        posProfile: "POS-001",
        start: 0,
      }),
    );

    fireEvent.press(screen.getByLabelText("Open POS-INV-0001"));

    expect(onOpenInvoice).toHaveBeenCalledWith({
      doctype: "POS Invoice",
      name: "POS-INV-0001",
    });
  });

  it("changes the history query when switching to sales orders", async () => {
    const screen = await renderScreen();

    expect(
      screen.getByRole("tab", { name: "Sales history" }).props
        .accessibilityState,
    ).toEqual({
      selected: true,
    });
    expect(
      screen.getByRole("tab", { name: "Sales orders" }).props
        .accessibilityState,
    ).toEqual({
      selected: false,
    });

    fireEvent.press(screen.getByRole("tab", { name: "Sales orders" }));

    await waitFor(() =>
      expect(mockUsePosInvoiceHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ documentType: "Order" }),
          start: 0,
        }),
      ),
    );
    expect(
      screen.getByRole("tab", { name: "Sales orders" }).props
        .accessibilityState,
    ).toEqual({
      selected: true,
    });
    expect(screen.getByText("Orders")).toBeTruthy();
  });

  it("applies draft filters, resets pagination, and clears them without losing the document type", async () => {
    const screen = await renderScreen();

    fireEvent.press(screen.getByText("Next"));
    await waitFor(() =>
      expect(mockUsePosInvoiceHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({ start: 25 }),
      ),
    );

    fireEvent.press(screen.getByLabelText("Open invoice filters"));
    await screen.findByLabelText("Set draft invoice");
    fireEvent.press(screen.getByLabelText("Set draft invoice"));
    await screen.findByText("Draft invoice: SINV-0002");
    fireEvent.press(screen.getByLabelText("Disable current shift"));
    await waitFor(() =>
      expect(screen.getByText("Draft invoice: SINV-0002")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("Apply draft filters"));

    await waitFor(() =>
      expect(mockUsePosInvoiceHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            currentShift: false,
            invoice: "SINV-0002",
          }),
          start: 0,
        }),
      ),
    );
    expect(screen.getByText("2 active filters")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("Open invoice filters"));
    await screen.findByLabelText("Clear draft filters");
    fireEvent.press(screen.getByLabelText("Clear draft filters"));
    await screen.findByText("Draft invoice: none");
    fireEvent.press(screen.getByLabelText("Apply draft filters"));

    await waitFor(() =>
      expect(mockUsePosInvoiceHistory).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({
            currentShift: true,
            documentType: "Invoice",
            invoice: "",
          }),
          start: 0,
        }),
      ),
    );
  });

  it("loads held invoices only after the held tab is selected", async () => {
    const screen = await renderScreen();

    expect(mockUsePosHeldInvoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false }),
    );

    fireEvent.press(screen.getByText("Held invoices"));

    await waitFor(() =>
      expect(mockUsePosHeldInvoices).toHaveBeenLastCalledWith(
        expect.objectContaining({
          enabled: true,
          posProfile: "POS-001",
        }),
      ),
    );
    expect(screen.getByText("No invoices are currently held.")).toBeTruthy();
  });
});
