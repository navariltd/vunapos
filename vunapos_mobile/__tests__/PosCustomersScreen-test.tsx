import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/theme/AppearanceProvider", () => ({
  useAppearance: () => ({
    palette: {
      background: "#ffffff",
      border: "#cccccc",
      borderSubtle: "#dddddd",
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

const mockUseNetworkStatus = jest.fn();
jest.mock("@/services/NetworkStatusProvider", () => ({
  useNetworkStatus: () => mockUseNetworkStatus(),
}));

const mockUsePosCustomerDirectory = jest.fn();
jest.mock("@/features/pos/hooks/usePosCustomerDirectory", () => ({
  usePosCustomerDirectory: (...args: unknown[]) =>
    mockUsePosCustomerDirectory(...args),
}));

import { PosCustomersScreen } from "@/features/pos/screens/PosCustomersScreen";

describe("PosCustomersScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseNetworkStatus.mockReturnValue({ connectionStatus: "online" });
    mockUsePosCustomerDirectory.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
  });

  afterEach(async () => cleanup());

  it("waits for the active POS Profile before exposing customers", async () => {
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled={false}
        onBackToPos={jest.fn()}
      />,
    );

    expect(
      screen.getByText("Loading POS Profile for customers…"),
    ).toBeTruthy();
  });

  it("shows the customer-management disabled state and returns to POS", async () => {
    const onBackToPos = jest.fn();
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled={false}
        onBackToPos={onBackToPos}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Customer management disabled")).toBeTruthy();
    expect(
      screen.getByText(
        "Customer management is disabled for this POS Profile.",
      ),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Back to POS" }));
    expect(onBackToPos).toHaveBeenCalledTimes(1);
  });

  it("opens the Customer tab shell when the profile permits management", async () => {
    mockUsePosCustomerDirectory.mockReturnValue({
      data: {
        as_of: "2026-09-13 09:00:00",
        customer_groups: ["Commercial"],
        customers: [
          {
            currency: "KES",
            customer: "CUST-001",
            customer_group: "Commercial",
            customer_name: "ABC Corp",
            customer_type: "Company",
            email_id: "accounts@example.com",
            last_purchase_date: "2026-09-10",
            loyalty_points: 42,
            mobile_no: null,
            outstanding_balance: 1200,
            territory: "Nairobi",
          },
          {
            customer: "CUST-002",
            customer_name: "Restricted customer",
            last_purchase_date: null,
            loyalty_points: null,
            outstanding_balance: null,
          },
        ],
        financials_visible: true,
        limit: 25,
        loyalty_visible: true,
        start: 0,
        territories: ["Nairobi"],
        total_count: 2,
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled
        currencyPrecision={0}
        onBackToPos={jest.fn()}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("Customers")).toBeTruthy();
    expect(mockUsePosCustomerDirectory).toHaveBeenCalledWith("POS-001");
    expect(screen.getByText("ABC Corp")).toBeTruthy();
    expect(screen.getByText("accounts@example.com")).toBeTruthy();
    expect(screen.getByText("KES 1,200")).toBeTruthy();
    expect(screen.getByText("Commercial")).toBeTruthy();
    expect(screen.getByText("Company · Nairobi")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("10/09/2026")).toBeTruthy();
    expect(screen.getByText("Restricted customer")).toBeTruthy();
    expect(screen.getByText("Restricted")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("No purchases")).toBeTruthy();
  });

  it("shows a retryable directory error", async () => {
    const reload = jest.fn();
    mockUsePosCustomerDirectory.mockReturnValue({
      data: null,
      error: "You do not have access to customers.",
      isLoading: false,
      reload,
    });
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled
        onBackToPos={jest.fn()}
        posProfile="POS-001"
      />,
    );

    expect(
      screen.getByText("You do not have access to customers."),
    ).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry customers" }),
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("shows the directory loading state", async () => {
    mockUsePosCustomerDirectory.mockReturnValue({
      data: null,
      error: null,
      isLoading: true,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled
        onBackToPos={jest.fn()}
        posProfile="POS-001"
      />,
    );
    expect(screen.getByText("Loading customers…")).toBeTruthy();
  });

  it("shows the no-results directory state", async () => {
    mockUsePosCustomerDirectory.mockReturnValue({
      data: {
        as_of: "2026-09-13 09:00:00",
        customer_groups: [],
        customers: [],
        financials_visible: true,
        limit: 25,
        loyalty_visible: true,
        start: 0,
        territories: [],
        total_count: 0,
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCustomersScreen
        customerManagementEnabled
        onBackToPos={jest.fn()}
        posProfile="POS-001"
      />,
    );

    expect(screen.getByText("No customers match these filters.")).toBeTruthy();
  });
});
