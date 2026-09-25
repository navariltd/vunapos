import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));

const mockUseCheckoutLinkOptions = jest.fn();
jest.mock("@/features/pos/hooks/useCheckoutLinkOptions", () => ({
  useCheckoutLinkOptions: (field: unknown, query: unknown) =>
    mockUseCheckoutLinkOptions(field, query),
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      border: "#cccccc",
      error: "#b00020",
      onSurface: "#111111",
      onSurfaceMuted: "#666666",
      primary: "#00695c",
      scrim: "#00000080",
      success: "#008000",
      surface: "#ffffff",
      surfaceContainer: "#f2f2f2",
    },
  }),
}));

import { PosCheckoutFieldsCard } from "@/features/pos/components/PosCheckoutFieldsCard";

describe("PosCheckoutFieldsCard", () => {
  afterEach(async () => cleanup());

  beforeEach(() => {
    mockUseCheckoutLinkOptions.mockImplementation((field: unknown) =>
      field
        ? {
            error: null,
            isLoading: false,
            options: [{ label: "Cash", value: "Cash" }],
          }
        : { error: null, isLoading: false, options: [] },
    );
  });

  it("uses a popup for Select, a searchable combo box for Link, and text input for Data", async () => {
    const onChange = jest.fn();
    const screen = await render(
      <PosCheckoutFieldsCard
        fields={[
          {
            doctype: "Sales Order",
            fieldname: "custom_payment_status",
            fieldtype: "Select",
            label: "Payment status",
            options: "Paid\nUnpaid",
          },
          {
            doctype: "Sales Order",
            fieldname: "custom_mode_of_payment",
            fieldtype: "Link",
            label: "Mode of payment",
            options: "Mode of Payment",
          },
          {
            doctype: "Sales Order",
            fieldname: "custom_reference_no",
            fieldtype: "Data",
            label: "Reference number",
          },
        ]}
        onChange={onChange}
        transactionDoctype="Sales Order"
        values={{}}
      />,
    );

    await fireEvent.changeText(
      screen.getByLabelText("Reference number"),
      "REF-001",
    );
    expect(onChange).toHaveBeenLastCalledWith("custom_reference_no", "REF-001");

    await fireEvent.press(
      screen.getByLabelText("Choose Payment status"),
    );
    expect(screen.getAllByText("Select Payment status").length).toBeGreaterThan(
      0,
    );
    await fireEvent.press(screen.getByText("Paid"));
    expect(onChange).toHaveBeenLastCalledWith("custom_payment_status", "Paid");

    await fireEvent.press(
      screen.getByLabelText("Choose Mode of payment"),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Select Cash")).toBeTruthy(),
    );
    await fireEvent.press(screen.getByLabelText("Select Cash"));
    expect(onChange).toHaveBeenLastCalledWith("custom_mode_of_payment", "Cash");
  });
});
