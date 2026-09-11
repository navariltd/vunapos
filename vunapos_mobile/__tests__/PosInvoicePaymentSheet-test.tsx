import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));

jest.mock('@/features/pos/hooks/useReceiveInvoicePayment', () => ({
  useReceiveInvoicePayment: jest.fn(),
}));

import { useReceiveInvoicePayment } from '@/features/pos/hooks/useReceiveInvoicePayment';
import { PosInvoicePaymentSheet } from '@/features/pos/components/PosInvoicePaymentSheet';

const mockUseReceiveInvoicePayment = jest.mocked(useReceiveInvoicePayment);
const onComplete = jest.fn();
const onDismiss = jest.fn();
const receive = jest.fn();

function renderSheet() {
  return render(
    <PosInvoicePaymentSheet
      currency="KES"
      customer="CUST-001"
      invoice="SINV-0001"
      onComplete={onComplete}
      onDismiss={onDismiss}
      outstandingAmount={100}
      paymentModes={[{ default: true, mode_of_payment: 'Cash' }, { mode_of_payment: 'Bank', type: 'Bank' }]}
      posProfile="POS-001"
      visible
    />,
  );
}

describe('PosInvoicePaymentSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseReceiveInvoicePayment.mockReturnValue({ error: null, isSubmitting: false, receive });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('prevents overpayments before submitting anything', async () => {
    const screen = await renderSheet();

    await fireEvent.changeText(screen.getByLabelText('Payment amount'), '101');
    await fireEvent.press(screen.getByLabelText('Submit invoice payment'));

    expect(screen.getByText('The payment cannot exceed the invoice outstanding balance.')).toBeTruthy();
    expect(receive).not.toHaveBeenCalled();
  });

  it('submits a valid payment once and confirms the created Payment Entry', async () => {
    receive.mockResolvedValue({ name: 'ACC-PAY-0001' });
    const screen = await renderSheet();

    await fireEvent.press(screen.getByLabelText('Submit invoice payment'));

    expect(receive).toHaveBeenCalledWith({
      amount: 100,
      customer: 'CUST-001',
      invoice: 'SINV-0001',
      modeOfPayment: 'Cash',
      posProfile: 'POS-001',
      referenceDate: undefined,
      referenceNo: undefined,
    });
    expect(await screen.findByText('Payment Entry ACC-PAY-0001 was submitted successfully.')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Finish receiving payment'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
