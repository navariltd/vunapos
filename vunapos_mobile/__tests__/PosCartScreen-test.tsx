import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

import { PosCartScreen } from '@/features/pos/screens/PosCartScreen';

const onBack = jest.fn();
const onClear = jest.fn();
const onRemove = jest.fn();
const onUpdateQuantity = jest.fn();

describe('PosCartScreen', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('shows editable cart lines, totals, and item removal controls', async () => {
    const screen = await render(
      <PosCartScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 2, rate: 125, uom: 'Nos' }]}
        onBack={onBack}
        onClear={onClear}
        onRemove={onRemove}
        onUpdateQuantity={onUpdateQuantity}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }}
        subtotal={250}
      />,
    );

    expect(screen.getAllByText('KES 250.00')).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText('Increase quantity for Stock item'));
    expect(onUpdateQuantity).toHaveBeenCalledWith('ITEM-001', 3);

    await fireEvent.changeText(screen.getByLabelText('Quantity for Stock item'), '3.5');
    await fireEvent(screen.getByLabelText('Quantity for Stock item'), 'blur');
    expect(onUpdateQuantity).toHaveBeenCalledWith('ITEM-001', 3.5);

    await fireEvent.press(screen.getByLabelText('Remove Stock item from cart'));
    expect(onRemove).toHaveBeenCalledWith('ITEM-001');
  });
});
