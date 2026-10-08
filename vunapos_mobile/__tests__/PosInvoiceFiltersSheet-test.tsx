import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({ palette: require("@/theme/tokens").lightPalette }),
}));

import { PosInvoiceFiltersSheet } from "@/features/pos/components/PosInvoiceFiltersSheet";
import type { PosInvoiceHistoryFilters } from "@/features/pos/types";

const filters: PosInvoiceHistoryFilters = {
  currentShift: true,
  customer: "",
  documentType: "Invoice",
  fromDate: "",
  invoice: "",
  paymentMode: "",
  saleType: "",
  status: "",
  toDate: "",
};

describe("PosInvoiceFiltersSheet", () => {
  afterEach(async () => cleanup());

  it("labels the current-shift choice Yes and No without changing its boolean filter", async () => {
    const onChange = jest.fn();
    const props = {
      filters,
      onApply: jest.fn(),
      onChange,
      onClear: jest.fn(),
      onDismiss: jest.fn(),
      paymentModes: ["Cash"],
      visible: true,
    };
    const screen = await render(<PosInvoiceFiltersSheet {...props} />);

    expect(screen.getByText("Yes")).toBeTruthy();
    fireEvent(screen.getByLabelText("Current shift only"), "valueChange", false);
    expect(onChange).toHaveBeenCalledWith("currentShift", false);

    await screen.rerender(
      <PosInvoiceFiltersSheet
        {...props}
        filters={{ ...filters, currentShift: false }}
      />,
    );
    await waitFor(() => expect(screen.getByText("No")).toBeTruthy());
    expect(screen.queryByText("On")).toBeNull();
    expect(screen.queryByText("Off")).toBeNull();
  });
});
