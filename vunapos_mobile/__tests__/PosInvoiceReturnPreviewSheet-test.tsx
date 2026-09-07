import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@/features/pos/hooks/useInvoiceReturnPreview', () => ({
  useInvoiceReturnPreview: jest.fn(),
}));

import { useInvoiceReturnPreview } from '@/features/pos/hooks/useInvoiceReturnPreview';
import { PosInvoiceReturnPreviewSheet } from '@/features/pos/components/PosInvoiceReturnPreviewSheet';

const mockUseInvoiceReturnPreview = jest.mocked(useInvoiceReturnPreview);
const onDismiss = jest.fn();

describe('PosInvoiceReturnPreviewSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    const screen = await render(<PosInvoiceReturnPreviewSheet currency="KES" invoiceName="POS-INV-0001" onDismiss={onDismiss} posProfile="POS-001" visible />);

    expect(screen.getByText('Returnable item')).toBeTruthy();
    expect(screen.queryByText('Already returned item')).toBeNull();
    expect(screen.getByText('Sold 3 Nos')).toBeTruthy();
    expect(screen.getByText('Returned 1 Nos')).toBeTruthy();
    expect(screen.getByText('Available 2 Nos')).toBeTruthy();
    expect(screen.getByText('KES 200.00')).toBeTruthy();
  });

  it('closes without starting a return', async () => {
    const screen = await render(<PosInvoiceReturnPreviewSheet currency="KES" invoiceName="POS-INV-0001" onDismiss={onDismiss} posProfile="POS-001" visible />);

    await fireEvent.press(screen.getByLabelText('Close return items'));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
