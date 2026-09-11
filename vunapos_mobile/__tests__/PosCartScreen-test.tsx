import { cleanup, fireEvent, render } from "@testing-library/react-native";

jest.mock("react-native-paper", () => ({
  Text: require("react-native").Text,
}));

jest.mock("@/features/pos/components/PosCustomerPickerSheet", () => ({
  PosCustomerPickerSheet: () => null,
}));

jest.mock("@/features/pos/components/PosPriceListPickerSheet", () => ({
  PosPriceListPickerSheet: () => null,
}));

jest.mock("@/features/pos/components/PosUomPickerSheet", () => ({
  PosUomPickerSheet: () => null,
}));

jest.mock("@/features/pos/hooks/usePosCustomerLoyalty", () => ({
  usePosCustomerLoyalty: jest.fn(),
}));

jest.mock("@/features/pos/hooks/usePosItemBatches", () => ({
  usePosItemBatches: jest.fn(),
}));

import { PosCartScreen } from "@/features/pos/screens/PosCartScreen";
import { usePosCustomerLoyalty } from "@/features/pos/hooks/usePosCustomerLoyalty";
import { usePosItemBatches } from "@/features/pos/hooks/usePosItemBatches";
import { posDarkColors } from "@/theme/tokens";

const onBack = jest.fn();
const onCheckout = jest.fn();
const onClearSaleCustomer = jest.fn();
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
        onClearSaleCustomer={onClearSaleCustomer}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onClear={onClear}
        onRemove={onRemove}
        onRetry={onRetry}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        defaultSaleCustomer={{
          customer: "WALK-IN",
          customerName: "Walk-in customer",
          isWalkin: true,
        }}
        saleCustomer={{
          customer: "CUST-001",
          customerName: "Example customer",
        }}
        subtotal={250}
        taxes={[{ description: "VAT", tax_amount: 40 }]}
        totals={{ grand_total: 290, net_total: 250 }}
      />,
    );

    expect(screen.getAllByText("KES 250.00")).toHaveLength(2);
    expect(screen.getByText("KES 290.00")).toBeTruthy();
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
      backgroundColor: posDarkColors.primary,
    });

    await fireEvent.press(screen.getByLabelText("Use default sale customer"));
    expect(onClearSaleCustomer).toHaveBeenCalledTimes(1);
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
        onClearSaleCustomer={onClearSaleCustomer}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer
        defaultSaleCustomer={null}
        saleCustomer={null}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(
      screen.getByText(
        "Select a customer to calculate current pricing, tax, and stock before checkout.",
      ),
    ).toBeTruthy();
    const checkoutButton = screen.getByLabelText("Proceed to checkout");
    expect(checkoutButton.props.accessibilityState.disabled).toBe(true);
    expect(checkoutButton).toHaveStyle({
      backgroundColor: posDarkColors.disabled,
      opacity: 0.5,
    });
  });

  it("does not offer a reset when the profile default customer is already active", async () => {
    const defaultSaleCustomer = {
      customer: "WALK-IN",
      customerName: "Walk-in customer",
      isWalkin: true,
    };
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        defaultSaleCustomer={defaultSaleCustomer}
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
        onClearSaleCustomer={onClearSaleCustomer}
        onRemove={onRemove}
        onRetry={onRetry}
        onSelectSaleCustomer={onSelectSaleCustomer}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        requiresCustomer={false}
        saleCustomer={defaultSaleCustomer}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
        defaultSaleCustomer={null}
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
        onClearSaleCustomer={onClearSaleCustomer}
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
});
