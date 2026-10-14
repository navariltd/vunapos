import { cleanup, fireEvent, render, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

const mockDismissCartCustomerOptions = jest.fn();

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/components/PosCustomerComboBox", () => ({
  PosCustomerComboBox: require("react").forwardRef(({ accessibilityLabel, invalid, onSelect, selectedCustomer }: { accessibilityLabel: string; invalid?: boolean; onSelect: (customer: { customer: string; customerName: string }) => void; selectedCustomer?: { customerName: string } }, ref: React.Ref<{ dismiss: () => void }>) => {
    const { Pressable, TextInput, View } = require("react-native");
    require("react").useImperativeHandle(ref, () => ({ dismiss: mockDismissCartCustomerOptions }));
    return <View testID="customer-combobox-input-row" style={{ borderColor: invalid ? "#cc2929" : "#c7c7c7" }}>
      <TextInput accessibilityLabel={accessibilityLabel} value={selectedCustomer?.customerName || ""} />
      <Pressable accessibilityLabel="Choose cart customer" onPress={() => onSelect({ customer: "CUST-002", customerName: "Brian Kamau" })} />
    </View>;
  }),
}));

jest.mock("@/features/pos/components/PosPriceListPickerSheet", () => ({
  PosPriceListPickerSheet: () => null,
}));

jest.mock("@/features/pos/components/PosUomPickerSheet", () => ({
  PosUomPickerSheet: () => null,
}));

jest.mock("@/features/pos/components/ClearCartConfirmationDialog", () => ({
  ClearCartConfirmationDialog: ({
    onConfirm,
    onDismiss,
    visible,
  }: {
    onConfirm: () => void;
    onDismiss: () => void;
    visible: boolean;
  }) =>
    visible
      ? require("react").createElement(
          require("react-native").View,
          null,
          require("react").createElement(require("react-native").Pressable, {
            accessibilityLabel: "Cancel clear cart",
            onPress: onDismiss,
          }),
          require("react").createElement(require("react-native").Pressable, {
            accessibilityLabel: "Confirm clear cart",
            onPress: onConfirm,
          }),
        )
      : null,
}));

jest.mock("@/features/pos/components/ManagerPinApprovalDialog", () => ({
  ManagerPinApprovalDialog: ({
    onApproved,
    visible,
  }: {
    onApproved: (token: string) => void;
    visible: boolean;
  }) =>
    visible
      ? require("react").createElement(require("react-native").Pressable, {
          accessibilityLabel: "Approve protected removal",
          onPress: () => onApproved("manager-token"),
        })
      : null,
}));

jest.mock("@/features/pos/hooks/usePosCustomerLoyalty", () => ({
  usePosCustomerLoyalty: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosItemBatches", () => ({
  usePosItemBatches: jest.fn(),
}));

jest.mock("@/components/feedback/ToastProvider", () => ({
  useToast: () => ({
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  }),
}));

import { PosCartScreen } from "@/features/pos/screens/PosCartScreen";
import { usePosCustomerLoyalty } from "@/features/pos/hooks/usePosCustomerLoyalty";
import { usePosItemBatches } from "@/features/pos/hooks/usePosItemBatches";
import { lightPalette } from "@/theme/tokens";

const onBack = jest.fn();
const onCheckout = jest.fn();
const onSelectSaleCustomer = jest.fn();
const onClear = jest.fn();
const onRemove = jest.fn();
const onRetry = jest.fn();
const onUpdateBatchAllocations = jest.fn();
const onUpdateItemNote = jest.fn();
const onUpdatePricing = jest.fn();
const onUpdateQuantity = jest.fn();
const onUpdateSerialAllocations = jest.fn();
const mockUsePosCustomerLoyalty = jest.mocked(usePosCustomerLoyalty);
const mockUsePosItemBatches = jest.mocked(usePosItemBatches);

describe("PosCartScreen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosCustomerLoyalty.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    });
    mockUsePosItemBatches.mockReturnValue({
      data: {
        batches: [
          {
            available_qty: 4,
            batch_no: "BATCH-001",
            expiry_date: "2027-01-01",
            qty: 0,
          },
        ],
        item_code: "ITEM-001",
        requires_batch: true,
        serials: [
          { serial_no: "SERIAL-001" },
          { batch_no: "BATCH-001", serial_no: "SERIAL-002" },
        ],
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it("shows editable cart lines, totals, and item removal controls", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 2,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        customerShippingAddresses={[{ address_line1: "1 Main Street", name: "ADDR-001" }]}
        shippingAddressName="ADDR-001"
        subtotal={250}
        taxes={[{ description: "VAT", tax_amount: 40 }]}
        totals={{ grand_total: 290, net_total: 250 }}
      />,
    );

    expect(screen.getAllByText("KES 250.00")).toHaveLength(2);
    expect(screen.getByText("KES 290.00")).toBeTruthy();
    expect(screen.getByText("Subtotal")).toBeTruthy();
    expect(screen.getByText("Taxes")).toBeTruthy();
    expect(screen.getByText("KES 40.00")).toBeTruthy();
    expect(screen.queryByText("VAT Added")).toBeNull();
    expect(screen.queryByText("Total taxes and charges")).toBeNull();
    expect(screen.queryByText("Payment is collected at checkout.")).toBeNull();
    expect(screen.queryByText(/Updated /)).toBeNull();
    expect(screen.getByLabelText("Search cart customers").props.value).toBe("Example customer");
    await fireEvent.press(screen.getByLabelText("Choose cart customer"));
    expect(onSelectSaleCustomer).toHaveBeenCalledWith({
      customer: "CUST-002",
      customerName: "Brian Kamau",
    });
    await fireEvent.press(
      screen.getByLabelText("Increase quantity for Stock item"),
    );
    expect(onUpdateQuantity).toHaveBeenCalledWith("ITEM-001", 3);

    await fireEvent.changeText(
      screen.getByLabelText("Quantity for Stock item"),
      "3.5",
    );
    await fireEvent(screen.getByLabelText("Quantity for Stock item"), "blur");
    expect(onUpdateQuantity).toHaveBeenCalledWith("ITEM-001", 3.5);
    expect(screen.getByLabelText("Quantity for Stock item")).toHaveStyle({
      includeFontPadding: false,
      paddingVertical: 0,
      textAlignVertical: "center",
    });

    await fireEvent.press(screen.getByLabelText("Remove Stock item from cart"));
    expect(onRemove).toHaveBeenCalledWith("ITEM-001");

    await fireEvent.press(screen.getByLabelText("Proceed to checkout"));
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Proceed to checkout")).toHaveStyle({
      backgroundColor: lightPalette.onSurface,
      paddingHorizontal: 16,
    });
    expect(
      within(screen.getByTestId("cart-footer")).getByLabelText("Proceed to checkout"),
    ).toBeTruthy();

    expect(screen.queryByLabelText("Use default sale customer")).toBeNull();
  });

  it("shows complete available cartons without a repeating decimal", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 2500,
            conversion_factor: 24,
            is_stock_item: true,
            item_code: "F61",
            item_name: "Dairy Joy",
            qty: 104,
            rate: 100,
            stock_uom: "Pcs",
            uom: "Carton",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={null}
        subtotal={10400}
        taxes={[]}
        totals={{ grand_total: 10400, net_total: 10400 }}
      />,
    );

    expect(screen.queryByText("Available Cartons: 104")).toBeNull();
    await fireEvent.press(screen.getByLabelText("View details for Dairy Joy"));
    expect(screen.getByText("Available Cartons: 104")).toBeTruthy();
    expect(screen.queryByText(/104\.166/)).toBeNull();
    expect(
      screen.getByLabelText("Increase quantity for Dairy Joy").props.accessibilityState,
    ).toEqual({ disabled: true });
  });

  it("shows and lets the cashier choose a customer shipping address in the cart", async () => {
    const onSelectShippingAddress = jest.fn();
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        customerShippingAddresses={[
          {
            address_line1: "1 Main Street",
            address_title: "Main shop",
            city: "Nairobi",
            is_default: true,
            name: "ADDR-001",
          },
          {
            address_line1: "2 Market Road",
            address_title: "Market branch",
            city: "Nairobi",
            name: "ADDR-002",
          },
        ]}
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: true, available_qty: null, is_stock_item: false, item_code: "ITEM-001", item_name: "Stock item", qty: 1, rate: 10, uom: "Nos" }]}
        onBack={onBack}
        onCheckout={onCheckout}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onSelectShippingAddress={onSelectShippingAddress}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{ customer: "CUST-001", customerName: "Example customer" }}
        shippingAddressName="ADDR-001"
        subtotal={10}
        taxes={[]}
        totals={{ grand_total: 10, net_total: 10 }}
      />,
    );

    const addressInput = screen.getByLabelText("Search shipping addresses");
    expect(addressInput.props.value).toBe("1 Main Street, Nairobi");
    expect(screen.queryByLabelText("Select shipping address Main shop")).toBeNull();
    await fireEvent(addressInput, "focus");
    expect(screen.getByTestId("cart-shipping-address-options")).toHaveStyle({
      position: "absolute",
      top: "100%",
    });
    await fireEvent.changeText(
      addressInput,
      "unknown place",
    );
    expect(screen.getByText("No matching shipping addresses.")).toBeTruthy();
    expect(onSelectShippingAddress).toHaveBeenCalledWith("");
    await fireEvent.changeText(
      addressInput,
      "market road",
    );
    expect(
      screen.queryByLabelText("Select shipping address Main shop"),
    ).toBeNull();
    expect(onSelectShippingAddress).not.toHaveBeenCalledWith("ADDR-002");
    await fireEvent.press(
      screen.getByLabelText("Select shipping address Market branch"),
    );
    expect(onSelectShippingAddress).toHaveBeenCalledWith("ADDR-002");
    expect(screen.queryByLabelText("Select shipping address Market branch")).toBeNull();
    expect(screen.queryByLabelText("Close shipping address picker")).toBeNull();
  });

  it("dismisses customer and shipping options on an outside cart touch without changing the sale", async () => {
    const onSelectShippingAddress = jest.fn();
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        customerShippingAddresses={[{ address_line1: "1 Main Street", name: "ADDR-001" }]}
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: true, available_qty: null, is_stock_item: false, item_code: "ITEM-001", item_name: "Stock item", qty: 1, rate: 10, uom: "Nos" }]}
        onBack={onBack}
        onCheckout={onCheckout}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onSelectShippingAddress={onSelectShippingAddress}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{ customer: "CUST-001", customerName: "Example customer" }}
        shippingAddressName="ADDR-001"
        subtotal={10}
        taxes={[]}
        totals={{ grand_total: 10, net_total: 10 }}
      />,
    );

    await fireEvent(screen.getByLabelText("Search shipping addresses"), "focus");
    expect(screen.getByTestId("cart-shipping-address-options")).toBeTruthy();
    await fireEvent(screen.getByTestId("cart-footer"), "touchStart");
    expect(screen.queryByTestId("cart-shipping-address-options")).toBeNull();
    expect(mockDismissCartCustomerOptions).toHaveBeenCalled();
    expect(onSelectShippingAddress).not.toHaveBeenCalled();
    expect(onSelectSaleCustomer).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Search shipping addresses").props.value).toBe("1 Main Street");
  });

  it("shows a long selected shipping address from its beginning without constraining search typing", async () => {
    const address = "The first words of a very long delivery address, Warehouse Road, Industrial Area, Nairobi";
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        customerShippingAddresses={[{ formatted_address: address, name: "ADDR-LONG" }]}
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: true, available_qty: null, is_stock_item: false, item_code: "ITEM-001", item_name: "Stock item", qty: 1, rate: 10, uom: "Nos" }]}
        onBack={onBack}
        onCheckout={onCheckout}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{ customer: "CUST-001", customerName: "Example customer" }}
        shippingAddressName="ADDR-LONG"
        subtotal={10}
        taxes={[]}
        totals={{ grand_total: 10, net_total: 10 }}
      />,
    );

    const addressInput = screen.getByLabelText("Search shipping addresses");
    expect(addressInput.props.value).toBe(address);
    expect(addressInput.props.selection).toEqual({ start: 0, end: 0 });

    await fireEvent(addressInput, "focus");
    expect(addressInput.props.value).toBe("");
    expect(addressInput.props.selection).toBeUndefined();
    await fireEvent.changeText(addressInput, "warehouse");
    expect(addressInput.props.value).toBe("warehouse");
    expect(addressInput.props.selection).toBeUndefined();
  });

  it("highlights missing customer and shipping address, then permits checkout once both are selected", async () => {
    const onSelectShippingAddress = jest.fn();
    const props = {
      allowCustomerCreation: false,
      currency: "KES",
      customerShippingAddresses: [{ address_line1: "1 Main Street", name: "ADDR-001" }],
      error: null,
      isUpdating: false,
      items: [{ allow_negative_stock: true, available_qty: null, is_stock_item: false, item_code: "ITEM-001", item_name: "Stock item", qty: 1, rate: 10, uom: "Nos" }],
      onBack,
      onCheckout,
      onSelectSaleCustomer,
      onSelectShippingAddress,
      onClear,
      onRemove,
      onRetry,
      onUpdateQuantity,
      orderType: "Order" as const,
      subtotal: 10,
      taxes: [],
      totals: { grand_total: 10 },
    };
    const screen = await render(
      <PosCartScreen {...props} requiresCustomer saleCustomer={null} shippingAddressName="" />,
    );

    const checkoutButton = screen.getByLabelText("Proceed to checkout");
    expect(checkoutButton).toHaveStyle({ backgroundColor: lightPalette.disabled });
    await fireEvent.press(checkoutButton);
    expect(onCheckout).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-combobox-input-row")).toHaveStyle({ borderColor: lightPalette.error });
    expect(screen.getByTestId("cart-shipping-address-input-row")).toHaveStyle({ borderColor: lightPalette.error });
    expect(screen.getByText("Select a customer and shipping address above.")).toBeTruthy();

    const customer = { customer: "CUST-001", customerName: "Example customer" };
    await screen.rerender(<PosCartScreen {...props} requiresCustomer={false} saleCustomer={customer} shippingAddressName="" />);
    expect(screen.getByTestId("customer-combobox-input-row")).toHaveStyle({ borderColor: lightPalette.border });
    expect(screen.getByText("Select a shipping address above.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Proceed to checkout"));
    expect(onCheckout).not.toHaveBeenCalled();

    await fireEvent(screen.getByLabelText("Search shipping addresses"), "focus");
    await fireEvent.press(screen.getByLabelText("Select shipping address ADDR-001"));
    expect(onSelectShippingAddress).toHaveBeenCalledWith("ADDR-001");
    await screen.rerender(<PosCartScreen {...props} requiresCustomer={false} saleCustomer={customer} shippingAddressName="ADDR-001" />);
    expect(screen.queryByText("Select a shipping address above.")).toBeNull();
    expect(screen.getByTestId("cart-shipping-address-input-row")).toHaveStyle({ borderColor: lightPalette.border });
    expect(screen.getByLabelText("Proceed to checkout")).toHaveStyle({ backgroundColor: lightPalette.onSurface });
    await fireEvent.press(screen.getByLabelText("Proceed to checkout"));
    expect(onCheckout).toHaveBeenCalledTimes(1);
  });

  it("lets a Sales Order quantity exceed displayed stock without relaxing invoice controls", async () => {
    const props = {
      allowCustomerCreation: false,
      currency: "KES",
      error: null,
      isUpdating: false,
      items: [{
        allow_negative_stock: false,
        available_qty: 0,
        is_stock_item: true,
        item_code: "ITEM-001",
        item_name: "Out-of-stock item",
        qty: 1,
        rate: 10,
        uom: "Nos",
      }],
      onBack,
      onCheckout,
      onClear,
      onRemove,
      onRetry,
      onSelectSaleCustomer,
      onUpdateQuantity,
      requiresCustomer: false,
      saleCustomer: { customer: "CUST-001", customerName: "Customer" },
      subtotal: 10,
      taxes: [],
      totals: { grand_total: 10, net_total: 10 },
    };
    const screen = await render(<PosCartScreen {...props} orderType="Order" />);

    await fireEvent.press(screen.getByLabelText("Increase quantity for Out-of-stock item"));
    expect(onUpdateQuantity).toHaveBeenCalledWith("ITEM-001", 2);

    onUpdateQuantity.mockClear();
    await screen.rerender(<PosCartScreen {...props} orderType="Invoice" />);
    await fireEvent.press(screen.getByLabelText("Increase quantity for Out-of-stock item"));
    expect(onUpdateQuantity).not.toHaveBeenCalled();
  });

  it("keeps cart actions available without network gating", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(screen.getByText("Stock item")).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("Increase quantity for Stock item"),
    );
    await fireEvent.press(screen.getByLabelText("Proceed to checkout"));
    const clearButton = screen.getByLabelText("Clear cart");
    expect(screen.getByText("Clear Cart")).toBeTruthy();
    expect(screen.getByTestId("clear-cart-icon")).toBeTruthy();
    expect(StyleSheet.flatten(clearButton.props.style)).toMatchObject({
      backgroundColor: "#b4232b",
      minHeight: 48,
    });
    expect(
      within(screen.getByTestId("cart-secondary-actions")).getByLabelText("Clear cart"),
    ).toBeTruthy();
    await fireEvent.press(clearButton);

    expect(onUpdateQuantity).toHaveBeenCalledWith("ITEM-001", 2);
    expect(onCheckout).not.toHaveBeenCalled();
    expect(screen.getByText("Select a customer and shipping address above.")).toBeTruthy();
    expect(onClear).not.toHaveBeenCalled();
  });

  it("requires confirmation before clearing the whole cart", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Clear cart"));
    expect(onClear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Cancel clear cart"));
    expect(onClear).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("Clear cart"));
    await fireEvent.press(screen.getByLabelText("Confirm clear cart"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("holds an invoice cart through the provided action", async () => {
    const onHold = jest.fn().mockResolvedValue({ name: "SINV-0001" });
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onHold={onHold}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Hold cart"));
    expect(onHold).toHaveBeenCalledTimes(1);
    const secondaryActions = within(screen.getByTestId("cart-secondary-actions"));
    expect(secondaryActions.getByLabelText("Hold cart")).toBeTruthy();
    expect(secondaryActions.getByLabelText("Clear cart")).toBeTruthy();
    expect(
      within(screen.getByTestId("cart-footer")).getByLabelText("Proceed to checkout"),
    ).toBeTruthy();
  });

  it("offers Hold for a Sales Order cart", async () => {
    const onHold = jest.fn().mockResolvedValue({ name: "SAL-ORD-0001" });
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[{
          allow_negative_stock: false,
          available_qty: 4,
          is_stock_item: true,
          item_code: "ITEM-001",
          item_name: "Stock item",
          qty: 1,
          rate: 125,
        }]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onHold={onHold}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Order"
        requiresCustomer={false}
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Hold cart"));
    expect(onHold).toHaveBeenCalledTimes(1);
  });

  it("labels checkout as continuing when the cart comes from a held draft", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={null}
        sourceInvoice={{ doctype: "Sales Invoice", name: "SINV-HELD-001" }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(screen.getByLabelText("Continue checkout")).toBeTruthy();
  });

  it("requires a customer before checkout while retaining the temporary cart", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(screen.getByTestId("cart-customer-label")).toHaveStyle({ fontSize: 12 });
    expect(screen.getByTestId("cart-shipping-address-label")).toHaveStyle({ fontSize: 12 });
    expect(screen.getAllByText("*")).toHaveLength(2);
    const checkoutButton = screen.getByLabelText("Proceed to checkout");
    expect(checkoutButton.props.accessibilityState.disabled).toBe(false);
    expect(checkoutButton).toHaveStyle({
      backgroundColor: lightPalette.disabled,
    });
    expect(screen.getByText("Proceed to checkout")).toHaveStyle({ color: lightPalette.onSurface });
    await fireEvent.press(checkoutButton);
    expect(onCheckout).not.toHaveBeenCalled();
    expect(screen.getByTestId("customer-combobox-input-row")).toHaveStyle({ borderColor: lightPalette.error });
    expect(screen.getByLabelText("Search shipping addresses").props.editable).toBe(false);
    expect(screen.getByText("Select a customer and shipping address above.")).toBeTruthy();
  });

  it("shows the profile default customer without a separate reset action", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{ customer: "WALK-IN", customerName: "Walk-in customer", isWalkin: true }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(screen.getByLabelText("Search cart customers").props.value).toBe("Walk-in customer");
    expect(screen.queryByLabelText("Use default sale customer")).toBeNull();
  });

  it("shows the selected customer’s live loyalty state without making it a checkout requirement", async () => {
    mockUsePosCustomerLoyalty.mockReturnValue({
      data: {
        currency: "KES",
        enrolled: true,
        points: 60,
        program: "Vuna Rewards",
        redemption_value: 120,
        tier: "Gold",
      },
      error: null,
      isLoading: false,
    });
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        posProfile="POS-001"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(mockUsePosCustomerLoyalty).toHaveBeenCalledWith(
      "CUST-001",
      "POS-001",
    );
    expect(screen.getByLabelText("Customer loyalty status")).toBeTruthy();
    expect(screen.getByText("Vuna Rewards · Gold")).toBeTruthy();
    expect(screen.getByText("60 points available · KES 120.00")).toBeTruthy();
  });

  it("shows the server-permitted price-list selector only when profile switching is enabled", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        allowPriceListSwitching
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectPriceList={jest.fn()}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        priceList="Wholesale"
        priceListOptions={[{ name: "Retail" }, { name: "Wholesale" }]}
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(
      screen.getByLabelText("Select price list for this sale"),
    ).toBeTruthy();
    expect(screen.getByText("Wholesale")).toBeTruthy();
  });

  it("presents server-authoritative promotion, tax, free-item, and bundle context", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            amount: 0,
            bundle_items: [{ item_code: "COMP-001", qty: 2 }],
            discount_percentage: 20,
            is_free_item: true,
            is_product_bundle: true,
            is_stock_item: false,
            item_code: "ITEM-FREE",
            item_name: "Promotional bundle",
            item_tax_template: "VAT 16%",
            price_list_rate: 125,
            pricing_rules: ["September promotion"],
            qty: 1,
            rate: 0,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={0}
        taxes={[]}
        totals={{ grand_total: 0, net_total: 0 }}
      />,
    );

    expect(screen.getByText("Free item")).toBeTruthy();
    expect(screen.getByText("Bundle")).toBeTruthy();
    expect(screen.queryByText("Tax: VAT 16%")).toBeNull();
    await fireEvent.press(
      screen.getByLabelText("View details for Promotional bundle"),
    );
    expect(screen.getByText("Tax: VAT 16%")).toBeTruthy();
    expect(
      screen.getByText("Promotion applied: September promotion · 20% off"),
    ).toBeTruthy();
    expect(screen.getByText("Includes 1 bundle component.")).toBeTruthy();
    expect(
      screen.getByLabelText("Remove Promotional bundle from cart").props
        .accessibilityState.disabled,
    ).toBe(true);
  });

  it("expands a cart item to show its server-provided description and bundle quantities", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: null,
            bundle_items: [
              {
                item_code: "COMP-001",
                item_name: "Coffee beans",
                qty: 2,
                uom: "Bag",
              },
            ],
            description: "Gift hamper with two bags of coffee.",
            is_product_bundle: true,
            is_stock_item: false,
            item_code: "BUNDLE-001",
            item_name: "Coffee hamper",
            qty: 1,
            rate: 500,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={500}
        taxes={[]}
        totals={{ grand_total: 500, net_total: 500 }}
      />,
    );

    expect(screen.queryByLabelText("Details for Coffee hamper")).toBeNull();
    await fireEvent.press(
      screen.getByLabelText("View details for Coffee hamper"),
    );
    expect(screen.getByLabelText("Details for Coffee hamper")).toBeTruthy();
    expect(
      screen.getByText("Gift hamper with two bags of coffee."),
    ).toBeTruthy();
    expect(screen.getByText("Bundle components")).toBeTruthy();
    expect(screen.getByText("Coffee beans")).toBeTruthy();
    expect(screen.getByText("×2 Bag")).toBeTruthy();
    await fireEvent.press(
      screen.getByLabelText("Hide details for Coffee hamper"),
    );
    expect(screen.queryByLabelText("Details for Coffee hamper")).toBeNull();
  });

  it("offers configured units from a cart item’s details", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            conversion_factor: 1,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
            uoms: [
              { conversion_factor: 1, uom: "Nos" },
              { conversion_factor: 12, uom: "Box" },
            ],
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("View details for Stock item"));
    expect(screen.getByLabelText("Change unit for Stock item")).toBeTruthy();
    expect(screen.getByText("Unit of measure")).toBeTruthy();
  });

  it("edits an item note from its expanded cart details", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateItemNote={onUpdateItemNote}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("View details for Stock item"));
    expect(screen.getByText("No note added")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Edit note for Stock item"));
    await fireEvent.changeText(
      screen.getByLabelText("Note for Stock item"),
      "  Fragile  ",
    );
    await fireEvent(screen.getByLabelText("Note for Stock item"), "blur");
    expect(onUpdateItemNote).toHaveBeenCalledWith("ITEM-001", "Fragile");
    expect(screen.getByText("11/500")).toBeTruthy();
  });

  it("offers profile-permitted manual pricing controls and identifies the cashier audit", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        allowDiscountChange
        allowRateChange
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            price_list_rate: 125,
            pricing_override: { type: "rate", value: 100 },
            pricing_override_by: "cashier@example.com",
            qty: 1,
            rate: 100,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdatePricing={onUpdatePricing}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={100}
        taxes={[]}
        totals={{ grand_total: 100, net_total: 100 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("View details for Stock item"));
    expect(screen.getByText("Manual pricing")).toBeTruthy();
    expect(
      screen.getByText(
        "Manual price override: rate set to KES 100.00 · cashier@example.com",
      ),
    ).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Discount percentage for Stock item"),
      "10",
    );
    await fireEvent.press(
      screen.getByLabelText("Apply discount percentage for Stock item"),
    );
    expect(onUpdatePricing).toHaveBeenCalledWith("ITEM-001", {
      type: "discount_percentage",
      value: 10,
    });
    await fireEvent.press(
      screen.getByLabelText("Reset manual price for Stock item"),
    );
    expect(onUpdatePricing).toHaveBeenCalledWith("ITEM-001", undefined);
  });

  it("edits and saves quantities from the live batch list for a batch-tracked item", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            has_batch_no: true,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateBatchAllocations={onUpdateBatchAllocations}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        posProfile="POS-001"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("View details for Stock item"));
    await fireEvent.press(
      screen.getByLabelText("Edit batch allocation for Stock item"),
    );
    expect(screen.getByText("Available 4 · Expires 2027-01-01")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByLabelText("Allocation for batch BATCH-001"),
      "1",
    );
    await fireEvent.press(
      screen.getByLabelText("Save batch allocation for Stock item"),
    );
    expect(onUpdateBatchAllocations).toHaveBeenCalledWith("ITEM-001", [
      {
        available_qty: 4,
        batch_no: "BATCH-001",
        expiry_date: "2027-01-01",
        qty: 1,
      },
    ]);
  });

  it("requires and persists the exact serial selection for a serial-tracked item", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 2,
            has_serial_no: true,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 2,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        onUpdateSerialAllocations={onUpdateSerialAllocations}
        orderType="Invoice"
        posProfile="POS-001"
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={250}
        taxes={[]}
        totals={{ grand_total: 250, net_total: 250 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("View details for Stock item"));
    await fireEvent.press(
      screen.getByLabelText("Edit serial numbers for Stock item"),
    );
    expect(screen.getByText("Selected 0 / 2")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Select serial SERIAL-001"));
    expect(onUpdateSerialAllocations).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Select serial SERIAL-002"));
    expect(onUpdateSerialAllocations).toHaveBeenCalledWith("ITEM-001", [
      { serial_no: "SERIAL-001" },
      { batch_no: "BATCH-001", serial_no: "SERIAL-002" },
    ]);
  });

  it("requires manager approval before removing an item when the profile enables it", async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[
          {
            allow_negative_stock: false,
            available_qty: 4,
            is_stock_item: true,
            item_code: "ITEM-001",
            item_name: "Stock item",
            qty: 1,
            rate: 125,
            uom: "Nos",
          },
        ]}
        onBack={onBack}
        onCheckout={onCheckout}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        posProfile="POS-001"
        requireManagerPinForItemRemoval
        requiresCustomer={false}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    await fireEvent.press(screen.getByLabelText("Remove Stock item from cart"));
    expect(onRemove).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText("Approve protected removal"));
    expect(onRemove).toHaveBeenCalledWith("ITEM-001");
  });
});
