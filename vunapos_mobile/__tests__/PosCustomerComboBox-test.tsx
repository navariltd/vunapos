import { cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({ Text: require("react-native").Text }));
jest.mock("@/features/pos/hooks/usePosCustomerSearch", () => ({ usePosCustomerSearch: jest.fn() }));
jest.mock("@/features/pos/hooks/useCreatePosCustomer", () => ({ useCreatePosCustomer: jest.fn() }));

import { PosCustomerComboBox } from "@/features/pos/components/PosCustomerComboBox";
import { useCreatePosCustomer } from "@/features/pos/hooks/useCreatePosCustomer";
import { usePosCustomerSearch } from "@/features/pos/hooks/usePosCustomerSearch";
import { lightPalette } from "@/theme/tokens";

const mockUseCreatePosCustomer = jest.mocked(useCreatePosCustomer);
const mockUsePosCustomerSearch = jest.mocked(usePosCustomerSearch);
const create = jest.fn();
const onSelect = jest.fn();

describe("PosCustomerComboBox", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      lastUpdated: null,
      reload: jest.fn(),
      rows: [
        { customer: "CUST-001", customerName: "Acme Stores", defaultPriceList: null, email: null, mobile: "0700000001" },
        { customer: "CUST-002", customerName: "Brian Kamau", defaultPriceList: null, email: null, mobile: "0700000002" },
      ],
    });
    mockUseCreatePosCustomer.mockReturnValue({ create, error: null, isCreating: false });
  });

  afterEach(async () => cleanup());

  it("filters inline without changing the selected customer until an option is picked", async () => {
    const screen = await render(
      <PosCustomerComboBox
        accessibilityLabel="Search customers"
        allowCustomerCreation={false}
        onSelect={onSelect}
        posProfile="POS-001"
        selectedCustomer={{ customer: "CUST-001", customerName: "Acme Stores" }}
      />,
    );
    const input = screen.getByLabelText("Search customers");
    expect(input.props.value).toBe("Acme Stores");
    await fireEvent(input, "focus");
    await fireEvent.changeText(input, "brian");
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Select customer Acme Stores")).toBeNull();
    expect(screen.getByLabelText("Select customer Brian Kamau")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Select customer Brian Kamau"));
    expect(onSelect).toHaveBeenCalledWith({
      customer: "CUST-002",
      customerName: "Brian Kamau",
      defaultPriceList: null,
      email: null,
      mobile: "0700000002",
    });
    expect(screen.queryByLabelText("Select customer Brian Kamau")).toBeNull();
    expect(mockUsePosCustomerSearch).toHaveBeenCalledWith("brian", true, "POS-001");
  });

  it("floats cart options over following content without changing selection behavior", async () => {
    const screen = await render(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation={false} floatingOptions onSelect={onSelect} />,
    );
    await fireEvent(screen.getByLabelText("Search customers"), "focus");
    expect(screen.getByTestId("customer-combobox-options")).toHaveStyle({
      position: "absolute",
      top: "100%",
    });
    await fireEvent.press(screen.getByLabelText("Select customer Brian Kamau"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ customer: "CUST-002" }));
  });

  it("only offers customer creation when permitted, then selects the created customer", async () => {
    const screen = await render(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation={false} onSelect={onSelect} posProfile="POS-001" />,
    );
    await fireEvent(screen.getByLabelText("Search customers"), "focus");
    expect(screen.queryByLabelText("Create customer")).toBeNull();

    await screen.rerender(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation onSelect={onSelect} posProfile="POS-001" />,
    );
    create.mockResolvedValue({ customer: "CUST-003", customerName: "New Stores" });
    await fireEvent.press(screen.getByLabelText("Create customer"));
    await fireEvent.changeText(screen.getByLabelText("New customer name"), "New Stores");
    await fireEvent.press(screen.getByLabelText("Save customer"));
    await waitFor(() => expect(create).toHaveBeenCalledWith("New Stores", "POS-001"));
    expect(onSelect).toHaveBeenCalledWith({ customer: "CUST-003", customerName: "New Stores" });
    expect(screen.queryByLabelText("New customer name")).toBeNull();
  });

  it("does not open or change customer when disabled", async () => {
    const screen = await render(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation={false} disabled onSelect={onSelect} />,
    );
    await fireEvent(screen.getByLabelText("Search customers"), "focus");
    await fireEvent.press(screen.getByLabelText("Show customer options"));
    expect(screen.queryByLabelText("Select customer Acme Stores")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("marks a required but unselected customer with an error border", async () => {
    const screen = await render(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation={false} invalid onSelect={onSelect} />,
    );
    expect(screen.getByTestId("customer-combobox-input-row")).toHaveStyle({ borderColor: lightPalette.error });
    await screen.rerender(
      <PosCustomerComboBox accessibilityLabel="Search customers" allowCustomerCreation={false} onSelect={onSelect} selectedCustomer={{ customer: "CUST-001", customerName: "Acme Stores" }} />,
    );
    expect(screen.getByTestId("customer-combobox-input-row")).toHaveStyle({ borderColor: lightPalette.border });
  });
});
