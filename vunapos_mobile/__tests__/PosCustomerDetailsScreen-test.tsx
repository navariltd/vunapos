import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/hooks/usePosBootstrap", () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosCustomerDetails", () => ({
  usePosCustomerDetails: jest.fn(),
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      error: "#cc2929",
      onPrimary: "#ffffff",
      onSurface: "#111111",
      onSurfaceMuted: "#666666",
      primary: "#16794c",
      surface: "#ffffff",
      surfaceContainer: "#f3f3f3",
    },
  }),
}));

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosCustomerDetails } from "@/features/pos/hooks/usePosCustomerDetails";
import { PosCustomerDetailsScreen } from "@/features/pos/screens/PosCustomerDetailsScreen";

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosCustomerDetails = jest.mocked(usePosCustomerDetails);
const onBack = jest.fn();
const onReceivePayment = jest.fn();
const onStartSale = jest.fn();
const reloadBootstrap = jest.fn();
const reloadDetails = jest.fn();

describe("PosCustomerDetailsScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [],
        pos_profile: { currency: "KES", name: "POS-001" },
      },
      error: null,
      isLoading: false,
      reload: reloadBootstrap,
    });
    mockUsePosCustomerDetails.mockReturnValue({
      data: {
        address: {
          address_line1: "42 Vuna Street",
          address_line2: "Suite 5",
          city: "Nairobi",
          country: "Kenya",
          pincode: "00100",
          state: "Nairobi County",
        },
        as_of: "2026-09-07 10:00:00",
        balance: 1250,
        contact: { phone: "+254 700 000 000" },
        customer: {
          currency: "KES",
          customer: "CUST-001",
          customer_group: "Retail",
          customer_name: "Example customer",
          customer_type: "Company",
          email_id: "customer@example.com",
          is_walkin: true,
          tax_id: "P012345678X",
          territory: "Kenya",
        },
        loyalty: { points: 24, program: "Vuna rewards", tier: "Gold" },
      },
      error: null,
      isLoading: false,
      reload: reloadDetails,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("renders the linked customer profile and allows starting a new sale", async () => {
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    expect(mockUsePosCustomerDetails).toHaveBeenCalledWith({
      customer: "CUST-001",
      posProfile: "POS-001",
    });
    expect(screen.getByText("Example customer")).toBeTruthy();
    expect(screen.getByText("CUST-001 · Retail")).toBeTruthy();
    expect(screen.getByText("KES 1,250.00")).toBeTruthy();
    expect(screen.getByText("24")).toBeTruthy();
    expect(screen.getByText("07/09/2026 10:00:00")).toBeTruthy();
    expect(screen.getByText("+254 700 000 000")).toBeTruthy();
    expect(screen.getByText("customer@example.com")).toBeTruthy();
    expect(
      screen.getByText(
        "42 Vuna Street, Suite 5, Nairobi, Nairobi County, Kenya, 00100",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Receive payment")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Start new sale"));
    expect(onStartSale).toHaveBeenCalledWith({
      customer: "CUST-001",
      customerName: "Example customer",
      isWalkin: true,
      mobile: "+254 700 000 000",
      taxId: "P012345678X",
    });
  });

  it("returns to the customer directory", async () => {
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Back to customers"));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("shows a customer-detail loading state", async () => {
    mockUsePosCustomerDetails.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      reload: reloadDetails,
    });
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    expect(screen.getByText("Loading customer details…")).toBeTruthy();
  });

  it("uses the SPA-equivalent missing contact, address, and loyalty fallbacks", async () => {
    mockUsePosCustomerDetails.mockReturnValue({
      data: {
        address: null,
        as_of: "2026-09-07 10:00:00",
        balance: 0,
        contact: null,
        customer: {
          customer: "CUST-001",
          customer_name: "Example customer",
          customer_type: null,
          email_id: null,
          mobile_no: null,
          territory: null,
        },
        loyalty: null,
      },
      error: null,
      isLoading: false,
      reload: reloadDetails,
    });
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    expect(screen.getByText("Not enrolled")).toBeTruthy();
    expect(screen.getByText("No phone number")).toBeTruthy();
    expect(screen.getByText("No email address")).toBeTruthy();
    expect(
      screen.getByText("No permitted primary address available."),
    ).toBeTruthy();
  });

  it("shows a retryable detail error and lets the cashier return to customers", async () => {
    mockUsePosCustomerDetails.mockReturnValue({
      data: null,
      error: "You do not have access to this customer.",
      isLoading: false,
      reload: reloadDetails,
    });
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    expect(screen.getByText("You do not have access to this customer.")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry customer details" }),
    );
    expect(reloadBootstrap).toHaveBeenCalledTimes(1);
    expect(reloadDetails).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "Back to customers" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("explains when the selected customer is unavailable", async () => {
    mockUsePosCustomerDetails.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: reloadDetails,
    });
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onStartSale={onStartSale}
      />,
    );

    expect(screen.getByText("Customer not found.")).toBeTruthy();
  });

  it("opens Receive with the current customer selected", async () => {
    const screen = await render(
      <PosCustomerDetailsScreen
        customer="CUST-001"
        onBack={onBack}
        onReceivePayment={onReceivePayment}
        onStartSale={onStartSale}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Receive payment"));

    expect(onReceivePayment).toHaveBeenCalledWith({
      customer: "CUST-001",
      customerName: "Example customer",
      isWalkin: true,
      mobile: "+254 700 000 000",
      taxId: "P012345678X",
    });
  });
});
