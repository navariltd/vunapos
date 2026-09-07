import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/hooks/usePosBootstrap', () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock('@/features/pos/hooks/usePosInvoiceDetails', () => ({
  usePosInvoiceDetails: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosInvoiceDetails } from '@/features/pos/hooks/usePosInvoiceDetails';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosInvoiceDetails = jest.mocked(usePosInvoiceDetails);
const onBack = jest.fn();
const onOpenCustomer = jest.fn();
const onStartSale = jest.fn();

describe('PosInvoiceDetailsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: { payment_modes: [], pos_profile: { currency: 'KES', name: 'POS-001' } },
      error: null,
      isLoading: false,
    });
    mockUsePosInvoiceDetails.mockReturnValue({
      data: {
        customer: 'CUST-001',
        customer_name: 'Example customer',
        currency: 'KES',
        docstatus: 1,
        doctype: 'POS Invoice',
        is_return: false,
        items: [
          {
            amount: 375,
            batch_allocations: [
              { batch_no: 'BATCH-001', qty: 2 },
              { batch_no: 'BATCH-002', qty: 1 },
            ],
            item_code: 'ITEM-BATCHED',
            item_name: 'Batched item',
            qty: 3,
            rate: 125,
            row_name: 'row-batched',
            uom: 'Nos',
          },
          {
            amount: 200,
            batch_no: 'LEGACY-BATCH',
            item_code: 'ITEM-LEGACY',
            item_name: 'Legacy batch item',
            qty: 1,
            rate: 200,
            row_name: 'row-legacy',
            uom: 'Nos',
          },
          {
            amount: 50,
            item_code: 'ITEM-PLAIN',
            item_name: 'Plain item',
            qty: 1,
            rate: 50,
            row_name: 'row-plain',
            uom: 'Nos',
          },
        ],
        name: 'POS-INV-0001',
        status: 'Paid',
        totals: { grand_total: 625, outstanding_amount: 0, paid_amount: 625 },
      },
      error: null,
      isLoading: false,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders item quantities, rates, amounts, and batch allocations', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onStartSale={onStartSale} />);

    expect(screen.getByText('Batched item')).toBeTruthy();
    expect(screen.getByText('ITEM-BATCHED')).toBeTruthy();
    expect(screen.getByText('3 Nos · KES 125.00')).toBeTruthy();
    expect(screen.getByText('KES 375.00')).toBeTruthy();
    expect(screen.getByText('Batch · BATCH-001 (2), BATCH-002 (1)')).toBeTruthy();
    expect(screen.getByText('Batch · LEGACY-BATCH')).toBeTruthy();
    expect(screen.queryByText('Batch ·')).toBeNull();
  });

  it('returns to the invoice list from the detail header', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('Back to invoices'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('opens the linked customer profile', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('View customer'));

    expect(onOpenCustomer).toHaveBeenCalledWith('CUST-001');
  });

  it('starts a new sale for the invoice customer', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('Start new sale'));

    expect(onStartSale).toHaveBeenCalledWith({ customer: 'CUST-001', customerName: 'Example customer' });
  });
});
