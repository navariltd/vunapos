import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@/features/pos/hooks/usePosBootstrap', () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock('@/features/pos/hooks/usePosInvoiceDetails', () => ({
  usePosInvoiceDetails: jest.fn(),
}));

jest.mock('@/features/pos/hooks/useInvoiceReceipt', () => ({
  useInvoiceReceipt: jest.fn(),
}));

jest.mock('@/features/pos/hooks/useErpNextRecord', () => ({
  useErpNextRecord: jest.fn(),
}));

jest.mock('@/features/pos/hooks/useInvoiceReturnPreview', () => ({
  useInvoiceReturnPreview: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosInvoiceDetails } from '@/features/pos/hooks/usePosInvoiceDetails';
import { useInvoiceReceipt } from '@/features/pos/hooks/useInvoiceReceipt';
import { useErpNextRecord } from '@/features/pos/hooks/useErpNextRecord';
import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { PosInvoiceDetailsScreen } from '@/features/pos/screens/PosInvoiceDetailsScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosInvoiceDetails = jest.mocked(usePosInvoiceDetails);
const mockUseInvoiceReceipt = jest.mocked(useInvoiceReceipt);
const mockUseErpNextRecord = jest.mocked(useErpNextRecord);
const mockUseInvoiceReturnPreview = jest.mocked(useInvoiceReturnPreview);
const onBack = jest.fn();
const onOpenCustomer = jest.fn();
const onOpenPaymentEntry = jest.fn();
const onOpenReturn = jest.fn();
const onStartSale = jest.fn();

describe('PosInvoiceDetailsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseInvoiceReceipt.mockReturnValue({ error: null, isWorking: false, printReceipt: jest.fn(), shareReceipt: jest.fn() });
    mockUseErpNextRecord.mockReturnValue({ error: null, isOpening: false, openRecord: jest.fn() });
    mockUseInvoiceReturnPreview.mockReturnValue({ data: null, error: null, isLoading: false });
    mockUsePosBootstrap.mockReturnValue({
      data: { payment_modes: [{ default: true, mode_of_payment: 'Cash' }], pos_profile: { allow_customer_payments: true, currency: 'KES', name: 'POS-001' } },
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
        payment_entries: [{ allocated_amount: 150, docstatus: 1, mode_of_payment: 'Cash', name: 'ACC-PAY-0001', posting_date: '2026-09-07', received_amount: 150, unallocated_amount: 0 }],
        returns: [{ docstatus: 1, grand_total: -125, name: 'POS-INV-RET-0001', posting_date: '2026-09-06' }],
        status: 'Paid',
        totals: { grand_total: 625, outstanding_amount: 150, paid_amount: 475 },
      },
      error: null,
      isLoading: false,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('renders item quantities, rates, amounts, and batch allocations', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    expect(screen.getByText('Batched item')).toBeTruthy();
    expect(screen.getByText('ITEM-BATCHED')).toBeTruthy();
    expect(screen.getByText('3 Nos · KES 125.00')).toBeTruthy();
    expect(screen.getByText('KES 375.00')).toBeTruthy();
    expect(screen.getByText('Batch · BATCH-001 (2), BATCH-002 (1)')).toBeTruthy();
    expect(screen.getByText('Batch · LEGACY-BATCH')).toBeTruthy();
    expect(screen.queryByText('Batch ·')).toBeNull();
    expect(screen.getByLabelText('Print receipt')).toBeTruthy();
    expect(screen.getByLabelText('Share receipt')).toBeTruthy();
    expect(screen.getByLabelText('Open in ERPNext')).toBeTruthy();
    expect(screen.getByLabelText('Return items')).toBeTruthy();
  });

  it('returns to the invoice list from the detail header', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('Back to invoices'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('opens the linked customer profile', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('View customer'));

    expect(onOpenCustomer).toHaveBeenCalledWith('CUST-001');
  });

  it('starts a new sale for the invoice customer', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    await fireEvent.press(screen.getByLabelText('Start new sale'));

    expect(onStartSale).toHaveBeenCalledWith({ customer: 'CUST-001', customerName: 'Example customer' });
  });

  it('offers payment only for an outstanding eligible invoice', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    expect(screen.getByLabelText('Receive payment')).toBeTruthy();
  });

  it('lists linked Payment Entries and opens the selected payment', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    expect(screen.getByText('Linked Payment Entries')).toBeTruthy();
    expect(screen.getByText('ACC-PAY-0001')).toBeTruthy();
    expect(screen.getByText('Allocated KES 150.00')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('View payment ACC-PAY-0001'));

    expect(onOpenPaymentEntry).toHaveBeenCalledWith(expect.objectContaining({ allocated_amount: 150, name: 'ACC-PAY-0001' }), 'KES');
  });

  it('lists linked credit notes and opens the selected return', async () => {
    const screen = await render(<PosInvoiceDetailsScreen invoiceName="POS-INV-0001" onBack={onBack} onOpenCustomer={onOpenCustomer} onOpenPaymentEntry={onOpenPaymentEntry} onOpenReturn={onOpenReturn} onStartSale={onStartSale} />);

    expect(screen.getByText('Returns and credit notes')).toBeTruthy();
    expect(screen.getByText('POS-INV-RET-0001')).toBeTruthy();
    expect(screen.getAllByText(/KES.*125\.00/).length).toBeGreaterThan(0);

    await fireEvent.press(screen.getByLabelText('View credit note POS-INV-RET-0001'));

    expect(onOpenReturn).toHaveBeenCalledWith(expect.objectContaining({ name: 'POS-INV-RET-0001' }));
  });
});
