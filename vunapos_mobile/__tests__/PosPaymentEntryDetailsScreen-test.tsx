import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@/features/pos/hooks/useErpNextRecord', () => ({
  useErpNextRecord: jest.fn(),
}));

import { useErpNextRecord } from '@/features/pos/hooks/useErpNextRecord';
import { PosPaymentEntryDetailsScreen } from '@/features/pos/screens/PosPaymentEntryDetailsScreen';

const onBack = jest.fn();
const mockUseErpNextRecord = jest.mocked(useErpNextRecord);

describe('PosPaymentEntryDetailsScreen', () => {
  beforeEach(() => {
    mockUseErpNextRecord.mockReturnValue({ error: null, isOpening: false, openRecord: jest.fn() });
  });

  afterEach(async () => {
    await cleanup();
    jest.clearAllMocks();
  });

  it('shows the linked payment summary and returns to the invoice', async () => {
    const screen = await render(
      <PosPaymentEntryDetailsScreen
        currency="KES"
        onBack={onBack}
        paymentEntry={{ allocated_amount: 150, docstatus: 1, mode_of_payment: 'Cash', name: 'ACC-PAY-0001', posting_date: '2026-09-07', received_amount: 200, unallocated_amount: 50 }}
      />,
    );

    expect(screen.getByText('ACC-PAY-0001')).toBeTruthy();
    expect(screen.getByText('Payment mode')).toBeTruthy();
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(screen.getByText('Applied to invoice')).toBeTruthy();
    expect(screen.getAllByText('KES 150.00')).toHaveLength(1);
    expect(screen.getByLabelText('Open in ERPNext')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Back to invoice'));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('identifies a cancelled payment entry', async () => {
    const screen = await render(
      <PosPaymentEntryDetailsScreen
        currency="KES"
        onBack={onBack}
        paymentEntry={{ allocated_amount: 0, docstatus: 2, name: 'ACC-PAY-0002', received_amount: 0, unallocated_amount: 0 }}
      />,
    );

    expect(screen.getAllByText('Cancelled')).toHaveLength(2);
  });
});
