import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('react-native-paper', () => ({
  Text: require('react-native').Text,
}));

jest.mock('@expo/ui/community/datetime-picker', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    DateTimePicker: (props: object) => <View accessibilityLabel="Credit sale date picker" {...props} />,
  };
});

jest.mock('@/features/pos/hooks/usePosBootstrap', () => ({
  usePosBootstrap: jest.fn(),
}));

jest.mock('@/features/pos/hooks/usePosCheckout', () => ({
  usePosCheckoutPreview: jest.fn(),
  useSubmitPosCheckout: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosCheckoutPreview, useSubmitPosCheckout } from '@/features/pos/hooks/usePosCheckout';
import { PosCheckoutScreen } from '@/features/pos/screens/PosCheckoutScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosCheckoutPreview = jest.mocked(usePosCheckoutPreview);
const mockUseSubmitPosCheckout = jest.mocked(useSubmitPosCheckout);
const clearError = jest.fn();
const submit = jest.fn();
const onComplete = jest.fn();

describe('PosCheckoutScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [{ default: true, mode_of_payment: 'Cash' }],
        pos_profile: { allow_credit_sales: true, name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    mockUsePosCheckoutPreview.mockReturnValue({
      data: { items: [], totals: { grand_total: 116, net_total: 100 } },
      error: null,
      isLoading: false,
    });
    mockUseSubmitPosCheckout.mockReturnValue({ clearError, error: null, isSubmitting: false, submit });
  });

  afterEach(async () => {
    await cleanup();
  });

  it('uses the native POS confirmation dialog before submitting an invoice', async () => {
    submit.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0001' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Complete sale'));

    expect(screen.getByText('Confirm submission of sales invoice for ABC Corps?')).toBeTruthy();
    expect(screen.getByLabelText('Confirm sales invoice submission')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      customer: 'CUST-001',
      orderType: 'Invoice',
      payments: [{ amount: 116, mode_of_payment: 'Cash' }],
      posProfile: 'POS-001',
    })));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({ doctype: 'Sales Invoice', name: 'SINV-0001' }));
  });

  it('keeps the confirmation dialog visible with a submitting state during submission', async () => {
    submit.mockReturnValue(new Promise(() => undefined));
    const props = {
      currency: 'KES',
      items: [{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }],
      onBack: jest.fn(),
      onComplete,
      orderType: 'Invoice' as const,
      saleCustomer: { customer: 'CUST-001', customerName: 'ABC Corps' },
      subtotal: 100,
    };
    const screen = await render(<PosCheckoutScreen {...props} />);

    await fireEvent.press(screen.getByLabelText('Complete sale'));
    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    mockUseSubmitPosCheckout.mockReturnValue({ clearError, error: null, isSubmitting: true, submit });
    await screen.rerender(<PosCheckoutScreen {...props} />);

    expect(screen.getByText('Submitting sales invoice…')).toBeTruthy();
    expect(screen.getByText('Please wait while the sale is confirmed.')).toBeTruthy();
  });

  it('sends the selected credit sale due date and clears old submission errors', async () => {
    submit.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0002' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent(screen.getByLabelText('Enable credit sale'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Complete sale'));
    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      dueDate: new Date().toISOString().slice(0, 10),
      isCreditSale: true,
      payments: [],
    })));
    expect(clearError).toHaveBeenCalled();
  });

  it('accepts a credit-sale deposit and submits its outstanding balance as credit', async () => {
    submit.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0004' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent(screen.getByLabelText('Enable credit sale'), 'valueChange', true);
    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '40');

    expect(screen.getByText('Optionally record a deposit. The remaining balance will be recorded as credit.')).toBeTruthy();
    expect(screen.getByText('Deposit + credit')).toBeTruthy();
    expect(screen.getAllByText('Outstanding')).toHaveLength(2);

    await fireEvent.press(screen.getByLabelText('Complete sale'));
    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      isCreditSale: true,
      payments: [{ amount: 40, mode_of_payment: 'Cash' }],
    })));
  });

  it('uses the POS Profile credit-sale default and provides the SPA-style switch', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [{ default: true, mode_of_payment: 'Cash' }],
        pos_profile: { allow_credit_sales: true, default_sale_type: 'Credit Sale', name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('Enable credit sale').props.value).toBe(true));
    expect(screen.getByLabelText('Choose credit sale due date')).toBeTruthy();
  });

  it('uses a native date picker and prevents credit due dates before the posting date', async () => {
    mockUsePosCheckoutPreview.mockReturnValue({
      data: { items: [], posting_date: '2026-09-10', totals: { grand_total: 116, net_total: 100 } },
      error: null,
      isLoading: false,
    });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent(screen.getByLabelText('Enable credit sale'), 'valueChange', true);
    await fireEvent.press(screen.getByLabelText('Choose credit sale due date'));

    const picker = screen.getByLabelText('Credit sale date picker');
    expect(picker.props.minimumDate).toEqual(new Date(2026, 8, 10, 12));

    await fireEvent(picker, 'valueChange', {}, new Date(2026, 8, 12, 12));
    expect(screen.getByText('Sep 12, 2026')).toBeTruthy();
  });

  it('renders the authoritative item, tax, total, and payment review summary', async () => {
    mockUsePosCheckoutPreview.mockReturnValue({
      data: {
        items: [{ amount: 100, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, row_name: 'item-row', uom: 'Nos' }],
        taxes: [{ description: 'VAT', included_in_print_rate: false, rate: 16, tax_amount: 16 }],
        totals: { grand_total: 116, net_total: 100, rounded_total: 116, total_taxes_and_charges: 16 },
      },
      error: null,
      isLoading: false,
    });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    expect(screen.getByText('Checkout summary')).toBeTruthy();
    expect(screen.getByText('1 × Stock item')).toBeTruthy();
    expect(screen.getByText('VAT · 16%')).toBeTruthy();
    expect(screen.getByText('Total taxes and charges')).toBeTruthy();
    expect(screen.getByText('Grand total')).toBeTruthy();
    expect(screen.getByText('Paid amount')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Balance')).toBeTruthy());
  });

  it('updates the review summary with cash change or an outstanding balance', async () => {
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('Cash amount').props.value).toBe('116.00'));
    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '120');
    expect(screen.getByText('Cash change')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '100');
    expect(screen.getByText('Outstanding')).toBeTruthy();
  });

  it('submits a split allocation across configured manual payment modes', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [
          { default: true, mode_of_payment: 'Cash', type: 'Cash' },
          { mode_of_payment: 'M-Pesa', type: 'Phone' },
        ],
        pos_profile: { name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    submit.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0003' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '16');
    await fireEvent.changeText(screen.getByLabelText('M-Pesa amount'), '100');
    await fireEvent.press(screen.getByLabelText('Complete sale'));
    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      payments: [{ amount: 16, mode_of_payment: 'Cash' }, { amount: 100, mode_of_payment: 'M-Pesa' }],
    })));
  });

  it('disables completion when an electronic payment exceeds the invoice total', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [
          { default: true, mode_of_payment: 'Cash', type: 'Cash' },
          { mode_of_payment: 'M-Pesa', type: 'Phone' },
        ],
        pos_profile: { name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Invoice"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('Cash amount').props.value).toBe('116.00'));
    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '');
    await fireEvent.changeText(screen.getByLabelText('M-Pesa amount'), '117');

    await waitFor(() => expect(screen.getByText('Only cash can exceed the total and return change.')).toBeTruthy());
    expect(screen.getByLabelText('Complete sale').props.accessibilityState.disabled).toBe(true);
  });
});
