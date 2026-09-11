import { Alert } from 'react-native';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@/features/pos/hooks/useInvoiceReturnPreview', () => ({
  useInvoiceReturnPreview: jest.fn(),
}));

jest.mock('@/features/pos/hooks/useCreateInvoiceReturn', () => ({
  useCreateInvoiceReturn: jest.fn(),
}));

import { useCreateInvoiceReturn } from '@/features/pos/hooks/useCreateInvoiceReturn';
import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { PosInvoiceReturnPreviewSheet } from '@/features/pos/components/PosInvoiceReturnPreviewSheet';

const mockUseCreateInvoiceReturn = jest.mocked(useCreateInvoiceReturn);
const mockUseInvoiceReturnPreview = jest.mocked(useInvoiceReturnPreview);
const create = jest.fn();
const onComplete = jest.fn();
const onDismiss = jest.fn();

describe('PosInvoiceReturnPreviewSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseCreateInvoiceReturn.mockReturnValue({ create, error: null, isSubmitting: false });
    mockUseInvoiceReturnPreview.mockReturnValue({
      data: {
        currency: 'KES',
        invoice: 'POS-INV-0001',
        items: [
          { item_code: 'ITEM-001', item_name: 'Returnable item', rate: 100, return_amount: 200, returnable_qty: 2, returned_qty: 1, row_name: 'row-1', sold_qty: 3, uom: 'Nos' },
          { item_code: 'ITEM-002', item_name: 'Already returned item', rate: 100, return_amount: 0, returnable_qty: 0, returned_qty: 1, row_name: 'row-2', sold_qty: 1, uom: 'Nos' },
        ],
      },
      error: null,
      isLoading: false,
    });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('shows only server-returnable items with their sold and returned quantities', async () => {
    const screen = await render(<PosInvoiceReturnPreviewSheet currency="KES" invoiceName="POS-INV-0001" onComplete={onComplete} onDismiss={onDismiss} posProfile="POS-001" visible />);

    expect(screen.getByText('Returnable item')).toBeTruthy();
    expect(screen.queryByText('Already returned item')).toBeNull();
    expect(screen.getByText('Sold 3 Nos')).toBeTruthy();
    expect(screen.getByText('Returned 1 Nos')).toBeTruthy();
    expect(screen.getByText('Available 2 Nos')).toBeTruthy();
    expect(screen.getByText('KES 200.00')).toBeTruthy();
  });

  it('closes without starting a return', async () => {
    const screen = await render(<PosInvoiceReturnPreviewSheet currency="KES" invoiceName="POS-INV-0001" onComplete={onComplete} onDismiss={onDismiss} posProfile="POS-001" visible />);

    await fireEvent.press(screen.getByLabelText('Close return items'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('selects a returnable item, caps its quantity, and creates the confirmed credit note', async () => {
    create.mockResolvedValue({
      duplicate: false,
      invoice: { docstatus: 1, name: 'POS-INV-RETURN-0001', posting_date: '2026-09-07', totals: { grand_total: -200 } },
    });
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'Create credit note')?.onPress?.();
    });
    const screen = await render(<PosInvoiceReturnPreviewSheet currency="KES" invoiceName="POS-INV-0001" onComplete={onComplete} onDismiss={onDismiss} posProfile="POS-001" visible />);

    await fireEvent.press(screen.getByLabelText('Add Returnable item to return'));
    expect(screen.getByLabelText('Return quantity for Returnable item').props.value).toBe('2');

    await fireEvent.changeText(screen.getByLabelText('Return quantity for Returnable item'), '');
    expect(screen.getByLabelText('Return quantity for Returnable item').props.value).toBe('');
    await fireEvent.changeText(screen.getByLabelText('Return quantity for Returnable item'), '1.5');
    expect(screen.getByLabelText('Return quantity for Returnable item').props.value).toBe('1.5');
    await fireEvent.changeText(screen.getByLabelText('Return quantity for Returnable item'), '10');
    expect(screen.getByLabelText('Return quantity for Returnable item').props.value).toBe('2');
    await fireEvent.changeText(screen.getByLabelText('Reason for return'), 'Damaged');
    await fireEvent.press(screen.getByLabelText('Create return credit note'));

    await waitFor(() => expect(create).toHaveBeenCalledWith({
      invoiceName: 'POS-INV-0001',
      items: [{ qty: 2, row_name: 'row-1' }],
      posProfile: 'POS-001',
      reason: 'Damaged',
    }));
    expect(await screen.findByText('POS-INV-RETURN-0001 created')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('View created credit note'));
    expect(onComplete).toHaveBeenCalledWith({ docstatus: 1, grand_total: -200, name: 'POS-INV-RETURN-0001', posting_date: '2026-09-07' });
  });
});
