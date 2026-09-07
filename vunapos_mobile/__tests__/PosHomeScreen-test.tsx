import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/components/PosCartButton', () => ({
  PosCartButton: () => null,
}));

jest.mock('@/features/pos/components/PosItemCard', () => ({
  PosItemCard: ({ item }: { item: { item_name: string } }) => {
    const { Text } = require('react-native');
    return <Text>{item.item_name}</Text>;
  },
}));

jest.mock('@/features/pos/components/PosItemSearch', () => ({
  PosItemSearch: () => {
    const { Text } = require('react-native');
    return <Text>Search items</Text>;
  },
}));

jest.mock('@/features/pos/hooks/usePosBootstrap', () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock('@/features/pos/hooks/usePosItemSearch', () => ({
  usePosItemSearch: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosItemSearch } from '@/features/pos/hooks/usePosItemSearch';
import { PosHomeScreen } from '@/features/pos/screens/PosHomeScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosItemSearch = jest.mocked(usePosItemSearch);
const onAddToCart = jest.fn();
const onClearSaleCustomer = jest.fn();

describe('PosHomeScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: { items: [], payment_modes: [], pos_profile: { currency: 'KES', name: 'POS-001' } },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosItemSearch.mockReturnValue({ error: null, isLoading: false, items: [] });
  });

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

  it('shows the authenticated bootstrap catalogue instead of preview items', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        items: [{ actual_qty: 3, item_code: 'LIVE-001', item_name: 'Live catalogue item', rate: 150 }],
        payment_modes: [],
        pos_profile: { currency: 'KES', name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(<PosHomeScreen cartItemCount={0} onAddToCart={onAddToCart} onClearSaleCustomer={onClearSaleCustomer} saleCustomer={null} />);

    expect(screen.getByText('Live catalogue item')).toBeTruthy();
  });

  it('shows a retryable error when the POS bootstrap cannot load', async () => {
    const reload = jest.fn();
    mockUsePosBootstrap.mockReturnValue({ data: null, error: 'Could not reach your company site.', isLoading: false, reload });
    const screen = await render(<PosHomeScreen cartItemCount={0} onAddToCart={onAddToCart} onClearSaleCustomer={onClearSaleCustomer} saleCustomer={null} />);

    expect(screen.getByText('Could not reach your company site.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry loading POS catalogue'));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
