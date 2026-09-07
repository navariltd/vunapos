import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/components/PosCustomerPickerSheet', () => ({
  PosCustomerPickerSheet: () => null,
}));

import { PosCartScreen } from '@/features/pos/screens/PosCartScreen';
import { posDarkColors } from '@/theme/tokens';

const onBack = jest.fn();
const onCheckout = jest.fn();
const onClearSaleCustomer = jest.fn();
const onSelectSaleCustomer = jest.fn();
const onClear = jest.fn();
const onRemove = jest.fn();
const onRetry = jest.fn();
const onUpdateQuantity = jest.fn();

describe('PosCartScreen', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('shows editable cart lines, totals, and item removal controls', async () => {
    const screen = await render(
      <PosCartScreen
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

    await fireEvent.press(screen.getByLabelText('Remove Stock item from cart'));
    expect(onRemove).toHaveBeenCalledWith('ITEM-001');

    await fireEvent.press(screen.getByLabelText('Proceed to checkout'));
    expect(onCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Proceed to checkout')).toHaveStyle({ backgroundColor: posDarkColors.primary });

    await fireEvent.press(screen.getByLabelText('Clear sale customer'));
    expect(onClearSaleCustomer).toHaveBeenCalledTimes(1);
  });

  it('requires a customer before checkout while retaining the temporary cart', async () => {
    const screen = await render(
      <PosCartScreen
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
});
