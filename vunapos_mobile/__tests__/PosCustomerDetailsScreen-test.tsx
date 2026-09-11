import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/hooks/usePosBootstrap', () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock('@/features/pos/hooks/usePosCustomerDetails', () => ({
  usePosCustomerDetails: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosCustomerDetails } from '@/features/pos/hooks/usePosCustomerDetails';
import { PosCustomerDetailsScreen } from '@/features/pos/screens/PosCustomerDetailsScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosCustomerDetails = jest.mocked(usePosCustomerDetails);
const onBack = jest.fn();
const onStartSale = jest.fn();

describe('PosCustomerDetailsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: { payment_modes: [], pos_profile: { currency: 'KES', name: 'POS-001' } },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosCustomerDetails.mockReturnValue({
      data: {
        address: { address_line1: '42 Vuna Street', city: 'Nairobi', country: 'Kenya' },
        as_of: '2026-09-07 10:00:00',
        balance: 1250,
        contact: { phone: '+254 700 000 000' },
        customer: {
          currency: 'KES',
          customer: 'CUST-001',
          customer_group: 'Retail',
          customer_name: 'Example customer',
          customer_type: 'Company',
          email_id: 'customer@example.com',
          is_walkin: true,
          tax_id: 'P012345678X',
          territory: 'Kenya',
        },
        loyalty: { points: 24, program: 'Vuna rewards', tier: 'Gold' },
      },
      error: null,
      isLoading: false,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders the linked customer profile and allows starting a new sale', async () => {
    const screen = await render(<PosCustomerDetailsScreen customer="CUST-001" onBack={onBack} onStartSale={onStartSale} />);

    expect(mockUsePosCustomerDetails).toHaveBeenCalledWith({ customer: 'CUST-001', posProfile: 'POS-001' });
    expect(screen.getByText('Example customer')).toBeTruthy();
    expect(screen.getByText('CUST-001 · Retail')).toBeTruthy();
    expect(screen.getByText('KES 1,250.00')).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
    expect(screen.getByText('+254 700 000 000')).toBeTruthy();
    expect(screen.getByText('customer@example.com')).toBeTruthy();
    expect(screen.getByText('42 Vuna Street, Nairobi, Kenya')).toBeTruthy();
    expect(screen.queryByText('Receive payment')).toBeNull();

    await fireEvent.press(screen.getByLabelText('Start new sale'));
    expect(onStartSale).toHaveBeenCalledWith({ customer: 'CUST-001', customerName: 'Example customer', isWalkin: true, mobile: '+254 700 000 000', taxId: 'P012345678X' });
  });

  it('returns to the invoice details screen', async () => {
    const screen = await render(<PosCustomerDetailsScreen customer="CUST-001" onBack={onBack} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('Back to invoice'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
