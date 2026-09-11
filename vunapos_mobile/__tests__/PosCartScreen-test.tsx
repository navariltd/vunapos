import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/components/PosCustomerPickerSheet', () => ({
  PosCustomerPickerSheet: () => null,
}));

jest.mock('@/features/pos/components/PosPriceListPickerSheet', () => ({
  PosPriceListPickerSheet: () => null,
}));

jest.mock('@/features/pos/hooks/usePosCustomerLoyalty', () => ({
  usePosCustomerLoyalty: jest.fn(),
}));

import { PosCartScreen } from '@/features/pos/screens/PosCartScreen';
import { usePosCustomerLoyalty } from '@/features/pos/hooks/usePosCustomerLoyalty';
import { posDarkColors } from '@/theme/tokens';

const onBack = jest.fn();
const onCheckout = jest.fn();
const onClearSaleCustomer = jest.fn();
const onSelectSaleCustomer = jest.fn();
const onClear = jest.fn();
const onRemove = jest.fn();
const onRetry = jest.fn();
const onUpdateQuantity = jest.fn();
const mockUsePosCustomerLoyalty = jest.mocked(usePosCustomerLoyalty);

describe('PosCartScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosCustomerLoyalty.mockReturnValue({ data: null, error: null, isLoading: false });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('shows editable cart lines, totals, and item removal controls', async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 2, rate: 125, uom: 'Nos' }]}
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
        defaultSaleCustomer={{ customer: 'WALK-IN', customerName: 'Walk-in customer', isWalkin: true }}
        saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }}
        subtotal={250}
        taxes={[{ description: 'VAT', tax_amount: 40 }]}
        totals={{ grand_total: 290, net_total: 250 }}
      />,
    );

    expect(screen.getAllByText('KES 250.00')).toHaveLength(2);
    expect(screen.getByText('KES 290.00')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Increase quantity for Stock item'));
    expect(onUpdateQuantity).toHaveBeenCalledWith('ITEM-001', 3);

    await fireEvent.changeText(screen.getByLabelText('Quantity for Stock item'), '3.5');
    await fireEvent(screen.getByLabelText('Quantity for Stock item'), 'blur');
    expect(onUpdateQuantity).toHaveBeenCalledWith('ITEM-001', 3.5);
    expect(screen.getByLabelText('Quantity for Stock item')).toHaveStyle({ includeFontPadding: false, paddingVertical: 0, textAlignVertical: 'center' });

    await fireEvent.press(screen.getByLabelText('Remove Stock item from cart'));
    expect(onRemove).toHaveBeenCalledWith('ITEM-001');

    await fireEvent.press(screen.getByLabelText('Proceed to checkout'));
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Proceed to checkout')).toHaveStyle({ backgroundColor: posDarkColors.primary });

    await fireEvent.press(screen.getByLabelText('Use default sale customer'));
    expect(onClearSaleCustomer).toHaveBeenCalledTimes(1);
  });

  it('requires a customer before checkout while retaining the temporary cart', async () => {
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 125, uom: 'Nos' }]}
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

    expect(screen.getByText('Select a customer to calculate current pricing, tax, and stock before checkout.')).toBeTruthy();
    const checkoutButton = screen.getByLabelText('Proceed to checkout');
    expect(checkoutButton.props.accessibilityState.disabled).toBe(true);
    expect(checkoutButton).toHaveStyle({ backgroundColor: posDarkColors.disabled, opacity: 0.5 });
  });

  it('does not offer a reset when the profile default customer is already active', async () => {
    const defaultSaleCustomer = { customer: 'WALK-IN', customerName: 'Walk-in customer', isWalkin: true };
    const screen = await render(
      <PosCartScreen
        allowCustomerCreation={false}
        currency="KES"
        defaultSaleCustomer={defaultSaleCustomer}
        error={null}
        isUpdating={false}
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 125, uom: 'Nos' }]}
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

    expect(screen.queryByLabelText('Use default sale customer')).toBeNull();
  });

  it('shows the selected customer’s live loyalty state without making it a checkout requirement', async () => {
    mockUsePosCustomerLoyalty.mockReturnValue({
      data: { currency: 'KES', enrolled: true, points: 60, program: 'Vuna Rewards', redemption_value: 120, tier: 'Gold' },
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
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 125, uom: 'Nos' }]}
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
        saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }}
        subtotal={125}
        taxes={[]}
        totals={{ grand_total: 125, net_total: 125 }}
      />,
    );

    expect(mockUsePosCustomerLoyalty).toHaveBeenCalledWith('CUST-001', 'POS-001');
    expect(screen.getByLabelText('Customer loyalty status')).toBeTruthy();
    expect(screen.getByText('Vuna Rewards · Gold')).toBeTruthy();
    expect(screen.getByText('60 points available · KES 120.00')).toBeTruthy();
  });

  it('shows the server-permitted price-list selector only when profile switching is enabled', async () => {
    const screen = await render(
      <PosCartScreen allowCustomerCreation={false} allowPriceListSwitching currency="KES" defaultSaleCustomer={null} error={null} isUpdating={false} items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 125, uom: 'Nos' }]} onBack={onBack} onCheckout={onCheckout} onClear={onClear} onClearSaleCustomer={onClearSaleCustomer} onRemove={onRemove} onRetry={onRetry} onSelectPriceList={jest.fn()} onSelectSaleCustomer={onSelectSaleCustomer} onUpdateQuantity={onUpdateQuantity} orderType="Invoice" priceList="Wholesale" priceListOptions={[{ name: 'Retail' }, { name: 'Wholesale' }]} requiresCustomer={false} saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }} subtotal={125} taxes={[]} totals={{ grand_total: 125, net_total: 125 }} />,
    );

    expect(screen.getByLabelText('Select price list for this sale')).toBeTruthy();
    expect(screen.getByText('Wholesale')).toBeTruthy();
  });

  it('presents server-authoritative promotion, tax, free-item, and bundle context', async () => {
    const screen = await render(
      <PosCartScreen allowCustomerCreation={false} currency="KES" defaultSaleCustomer={null} error={null} isUpdating={false} items={[{ allow_negative_stock: false, available_qty: 4, amount: 0, bundle_items: [{ item_code: 'COMP-001', qty: 2 }], discount_percentage: 20, is_free_item: true, is_product_bundle: true, is_stock_item: false, item_code: 'ITEM-FREE', item_name: 'Promotional bundle', item_tax_template: 'VAT 16%', price_list_rate: 125, pricing_rules: ['September promotion'], qty: 1, rate: 0, uom: 'Nos' }]} onBack={onBack} onCheckout={onCheckout} onClear={onClear} onClearSaleCustomer={onClearSaleCustomer} onRemove={onRemove} onRetry={onRetry} onSelectSaleCustomer={onSelectSaleCustomer} onUpdateQuantity={onUpdateQuantity} orderType="Invoice" requiresCustomer={false} saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }} subtotal={0} taxes={[]} totals={{ grand_total: 0, net_total: 0 }} />,
    );

    expect(screen.getByText('Free item')).toBeTruthy();
    expect(screen.getByText('Bundle')).toBeTruthy();
    expect(screen.getByText('Tax: VAT 16%')).toBeTruthy();
    expect(screen.getByText('Promotion applied: September promotion · 20% off')).toBeTruthy();
    expect(screen.getByText('Includes 1 bundle component.')).toBeTruthy();
    expect(screen.getByLabelText('Remove Promotional bundle from cart').props.accessibilityState.disabled).toBe(true);
  });

  it('expands a cart item to show its server-provided description and bundle quantities', async () => {
    const screen = await render(
      <PosCartScreen allowCustomerCreation={false} currency="KES" defaultSaleCustomer={null} error={null} isUpdating={false} items={[{ allow_negative_stock: false, available_qty: null, bundle_items: [{ item_code: 'COMP-001', item_name: 'Coffee beans', qty: 2, uom: 'Bag' }], description: 'Gift hamper with two bags of coffee.', is_product_bundle: true, is_stock_item: false, item_code: 'BUNDLE-001', item_name: 'Coffee hamper', qty: 1, rate: 500, uom: 'Nos' }]} onBack={onBack} onCheckout={onCheckout} onClear={onClear} onClearSaleCustomer={onClearSaleCustomer} onRemove={onRemove} onRetry={onRetry} onSelectSaleCustomer={onSelectSaleCustomer} onUpdateQuantity={onUpdateQuantity} orderType="Invoice" requiresCustomer={false} saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }} subtotal={500} taxes={[]} totals={{ grand_total: 500, net_total: 500 }} />,
    );

    expect(screen.queryByLabelText('Details for Coffee hamper')).toBeNull();
    await fireEvent.press(screen.getByLabelText('View details for Coffee hamper'));
    expect(screen.getByLabelText('Details for Coffee hamper')).toBeTruthy();
    expect(screen.getByText('Gift hamper with two bags of coffee.')).toBeTruthy();
    expect(screen.getByText('Bundle components')).toBeTruthy();
    expect(screen.getByText('Coffee beans')).toBeTruthy();
    expect(screen.getByText('×2 Bag')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Hide details for Coffee hamper'));
    expect(screen.queryByLabelText('Details for Coffee hamper')).toBeNull();
  });
});
