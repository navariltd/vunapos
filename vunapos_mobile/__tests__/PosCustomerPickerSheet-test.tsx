import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({ Text: require('react-native').Text }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('@/components/layout/KeyboardAwareFormScroll', () => ({
  KeyboardAwareFormScroll: ({ children }: { children: React.ReactNode }) => {
    const { ScrollView } = require('react-native');
    return <ScrollView>{children}</ScrollView>;
  },
}));
jest.mock('@/features/pos/hooks/usePosCustomerSearch', () => ({ usePosCustomerSearch: jest.fn() }));
jest.mock('@/features/pos/hooks/useCreatePosCustomer', () => ({ useCreatePosCustomer: jest.fn() }));

import { useCreatePosCustomer } from '@/features/pos/hooks/useCreatePosCustomer';
import { usePosCustomerSearch } from '@/features/pos/hooks/usePosCustomerSearch';
import { PosCustomerPickerSheet } from '@/features/pos/components/PosCustomerPickerSheet';

const mockUseCreatePosCustomer = jest.mocked(useCreatePosCustomer);
const mockUsePosCustomerSearch = jest.mocked(usePosCustomerSearch);
const create = jest.fn();
const onDismiss = jest.fn();
const onSelect = jest.fn();

describe('PosCustomerPickerSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosCustomerSearch.mockReturnValue({
      error: null,
      isLoading: false,
      isRefreshing: false,
      isStale: false,
      lastUpdated: null,
      reload: jest.fn(),
      rows: [],
    });
    mockUseCreatePosCustomer.mockReturnValue({ create, error: null, isCreating: false });
  });

  afterEach(async () => cleanup());

  it('only exposes customer creation when the POS profile allows it', async () => {
    const screen = await render(<PosCustomerPickerSheet allowCustomerCreation={false} onDismiss={onDismiss} onSelect={onSelect} posProfile="POS-001" visible />);
    expect(screen.queryByLabelText('Create customer')).toBeNull();

    await screen.rerender(<PosCustomerPickerSheet allowCustomerCreation onDismiss={onDismiss} onSelect={onSelect} posProfile="POS-001" visible />);
    expect(screen.getByLabelText('Create customer')).toBeTruthy();
  });

  it('selects a successfully created customer and closes the sheet', async () => {
    create.mockResolvedValue({ customer: 'CUST-001', customerName: 'Acme Stores' });
    const screen = await render(<PosCustomerPickerSheet allowCustomerCreation onDismiss={onDismiss} onSelect={onSelect} posProfile="POS-001" visible />);

    await fireEvent.press(screen.getByLabelText('Create customer'));
    await fireEvent.changeText(screen.getByLabelText('New customer name'), 'Acme Stores');
    await fireEvent.press(screen.getByLabelText('Save customer'));

    await waitFor(() => expect(create).toHaveBeenCalledWith('Acme Stores', 'POS-001'));
    expect(onSelect).toHaveBeenCalledWith({ customer: 'CUST-001', customerName: 'Acme Stores' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
