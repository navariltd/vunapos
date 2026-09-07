import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/components/PosCartButton', () => ({
  PosCartButton: () => null,
}));

jest.mock('@/features/pos/components/PosItemCard', () => ({
  PosItemCard: () => null,
}));

jest.mock('@/features/pos/components/PosItemSearch', () => ({
  PosItemSearch: () => {
    const { Text } = require('react-native');
    return <Text>Search items</Text>;
  },
}));

import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';

const onAddToCart = jest.fn();
const onClearSaleCustomer = jest.fn();

describe('PosHomeScreen', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('shows the selected customer for a new sale and supports clearing it', async () => {
    const screen = await render(
      <PosHomeScreen
        cartItemCount={0}
        onAddToCart={onAddToCart}
        onClearSaleCustomer={onClearSaleCustomer}
        saleCustomer={{ customer: 'CUST-001', customerName: 'Example customer' }}
      />,
    );

    expect(screen.getByText('Example customer')).toBeTruthy();
    expect(screen.getByText('CUST-001')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Clear sale customer'));
    expect(onClearSaleCustomer).toHaveBeenCalledTimes(1);
  });
});
