import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

import { PosInvoiceListItem } from "@/features/pos/components/PosInvoiceListItem";
import { PosInvoiceListRow, PosInvoiceStatus } from "@/features/pos/types";

const onPress = jest.fn();

function makeInvoice(
  overrides: Partial<PosInvoiceListRow> = {},
): PosInvoiceListRow {
  return {
    cashier: "Cashier One",
    creditSale: false,
    currency: "KES",
    customerId: "CUST-001",
    customerName: "Example customer",
    dueDate: undefined,
    invoiceNumber: "POS-INV-0001",
    itemCount: 1,
    openingEntry: "POS-OPEN-0001",
    outstandingAmount: 0,
    paymentMode: "Cash",
    payments: [],
    postedAt: "12/09/2026 · 09:30",
    status: "Paid",
    total: 100,
    ...overrides,
  };
}

describe("PosInvoiceListItem", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ["Paid", "#86efac"],
    ["Partly Paid", "#f3c579"],
    ["Unpaid", "#eb9091"],
    ["Overdue", "#eb9091"],
    ["Cancelled", "#eb9091"],
    ["Credit Note", "#f3c579"],
  ] as [PosInvoiceStatus, string][])(
    "presents %s with its mapped status colour",
    async (status, color) => {
      const screen = await render(
        <PosInvoiceListItem
          invoice={makeInvoice({ status })}
          onPress={onPress}
        />,
      );

      expect(StyleSheet.flatten(screen.getByText(status).props.style)).toEqual(
        expect.objectContaining({ color }),
      );
    },
  );

  it("renders credit, due-date, outstanding, payment-reference, and precise currency details", async () => {
    const screen = await render(
      <PosInvoiceListItem
        currencyPrecision={3}
        invoice={makeInvoice({
          creditSale: true,
          dueDate: "2026-10-05",
          outstandingAmount: 25.5,
          payments: [
            {
              amount: 74.5,
              mode_of_payment: "M-Pesa",
              transaction_reference: "QWE123",
            },
          ],
          total: 100,
        })}
        onPress={onPress}
      />,
    );

    expect(screen.getByText("Credit sale")).toBeTruthy();
    expect(screen.getByText(/Due .*2026/)).toBeTruthy();
    expect(screen.getByText("M-Pesa · QWE123")).toBeTruthy();
    expect(screen.getByText("KES 74.500")).toBeTruthy();
    expect(screen.getByText("Outstanding KES 25.500")).toBeTruthy();
    expect(screen.getByText("KES 100.000")).toBeTruthy();
  });

  it("uses the payment-request reference and opens its invoice", async () => {
    const screen = await render(
      <PosInvoiceListItem
        invoice={makeInvoice({
          payments: [
            {
              amount: 100,
              ke_payment_request: "REQ-0001",
              mode_of_payment: "M-Pesa",
            },
          ],
        })}
        onPress={onPress}
      />,
    );

    expect(screen.getByText("M-Pesa · REQ-0001")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Open POS-INV-0001"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("labels a credit sale without a deposit and keeps customer fallbacks readable", async () => {
    const screen = await render(
      <PosInvoiceListItem
        invoice={makeInvoice({
          customerId: undefined,
          customerName: "No customer",
          creditSale: true,
          paymentMode: "No deposit",
        })}
        onPress={onPress}
      />,
    );

    expect(screen.getByText("No customer")).toBeTruthy();
    expect(screen.getByText("No deposit")).toBeTruthy();
  });
});
