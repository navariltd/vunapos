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

jest.mock('@/features/pos/hooks/useGatewayPayment', () => ({
  useGatewayPayment: jest.fn(),
}));

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { useGatewayPayment } from '@/features/pos/hooks/useGatewayPayment';
import { usePosCheckoutPreview, useSubmitPosCheckout } from '@/features/pos/hooks/usePosCheckout';
import { PosCheckoutScreen } from '@/features/pos/screens/PosCheckoutScreen';

const mockUsePosBootstrap = jest.mocked(usePosBootstrap);
const mockUsePosCheckoutPreview = jest.mocked(usePosCheckoutPreview);
const mockUseSubmitPosCheckout = jest.mocked(useSubmitPosCheckout);
const mockUseGatewayPayment = jest.mocked(useGatewayPayment);
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
    mockUseGatewayPayment.mockReturnValue({
      attachC2B: jest.fn(),
      cancel: jest.fn(),
      clearError: jest.fn(),
      error: null,
      getStatus: jest.fn(),
      initiate: jest.fn(),
      isWorking: false,
      searchC2B: jest.fn(),
    });
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

  it('requires and submits a transaction reference for a configured bank payment mode', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [
          { default: true, mode_of_payment: 'Cash', type: 'Cash' },
          { mode_of_payment: 'Bank transfer', type: 'Bank' },
        ],
        pos_profile: {
          modes_of_payment: [{ mode_of_payment: 'Bank transfer', requires_reference: true, type: 'Bank' }],
          name: 'POS-001',
        },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    submit.mockResolvedValue({ doctype: 'Sales Invoice', name: 'SINV-0005' });
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

    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '');
    await fireEvent.changeText(screen.getByLabelText('Bank transfer amount'), '116');

    expect(screen.getByLabelText('Bank transfer transaction reference')).toBeTruthy();
    expect(screen.getByText('A transaction reference is required for Bank transfer.')).toBeTruthy();
    expect(screen.getByLabelText('Complete sale').props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(screen.getByLabelText('Bank transfer transaction reference'), 'RCP-001');
    await fireEvent.press(screen.getByLabelText('Complete sale'));
    await fireEvent.press(screen.getByLabelText('Confirm sales invoice submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      payments: [{ amount: 116, mode_of_payment: 'Bank transfer', reference_date: new Date().toISOString().slice(0, 10), reference_no: 'RCP-001' }],
    })));
  });

  it('blocks gateway checkout until the server confirms the gateway payment', async () => {
    const initiate = jest.fn().mockResolvedValue({ amount: 116, mode_of_payment: 'M-Pesa STK', name: 'GPL-001', status: 'Pending' });
    const getStatus = jest.fn().mockResolvedValue({ amount: 116, mode_of_payment: 'M-Pesa STK', name: 'GPL-001', status: 'Paid' });
    mockUseGatewayPayment.mockReturnValue({ attachC2B: jest.fn(), cancel: jest.fn(), clearError: jest.fn(), error: null, getStatus, initiate, isWorking: false, searchC2B: jest.fn() });
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [
          { default: true, mode_of_payment: 'Cash', type: 'Cash' },
          { mode_of_payment: 'M-Pesa STK', payment_gateway: 'M-Pesa', type: 'Phone' },
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
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps', mobile: '0712345678' }}
        subtotal={100}
      />,
    );

    await fireEvent.press(screen.getByLabelText('Pay with M-Pesa STK'));
    await fireEvent.press(screen.getByLabelText('Send STK payment request'));

    await waitFor(() => expect(initiate).toHaveBeenCalledWith(expect.objectContaining({
      amount: 116,
      customer: 'CUST-001',
      modeOfPayment: 'M-Pesa STK',
      phoneNumber: '0712345678',
      posProfile: 'POS-001',
    })));
    expect(screen.getByText('Verify the selected gateway payment to continue. Checkout unlocks after confirmation.')).toBeTruthy();
    expect(screen.getByLabelText('Complete sale').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(screen.getByLabelText('Check gateway payment status'));
    await waitFor(() => expect(getStatus).toHaveBeenCalledWith('GPL-001'));
    await waitFor(() => expect(screen.getByText('Payment verified.')).toBeTruthy());
    expect(screen.getByLabelText('Complete sale').props.accessibilityState.disabled).toBe(false);
  });

  it('searches for and attaches an exact matching C2B payment before enabling checkout', async () => {
    const attachC2B = jest.fn().mockResolvedValue({ amount: 116, mode_of_payment: 'M-Pesa STK', name: 'GPL-C2B-001', status: 'Paid' });
    const searchC2B = jest.fn().mockResolvedValue([{
      amount: 116,
      currency: 'KES',
      name: 'C2B-001',
      party_name: 'ABC Corps',
      transaction_id: 'TXN-001',
    }]);
    mockUseGatewayPayment.mockReturnValue({ attachC2B, cancel: jest.fn(), clearError: jest.fn(), error: null, getStatus: jest.fn(), initiate: jest.fn(), isWorking: false, searchC2B });
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [
          { default: true, mode_of_payment: 'Cash', type: 'Cash' },
          { mode_of_payment: 'M-Pesa STK', payment_gateway: 'M-Pesa', type: 'Phone' },
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

    await fireEvent.press(screen.getByLabelText('Pay with M-Pesa STK'));
    await fireEvent.press(screen.getByLabelText('Find C2B payment'));
    await fireEvent.changeText(screen.getByLabelText('Search C2B payments'), 'TXN-001');
    await fireEvent.press(screen.getByLabelText('Search incoming C2B payments'));

    await waitFor(() => expect(searchC2B).toHaveBeenCalledWith({
      currency: 'KES',
      customer: 'CUST-001',
      modeOfPayment: 'M-Pesa STK',
      posProfile: 'POS-001',
      query: 'TXN-001',
    }));
    await fireEvent.press(screen.getByLabelText('Attach C2B payment TXN-001'));
    await waitFor(() => expect(attachC2B).toHaveBeenCalledWith(expect.objectContaining({
      amount: 116,
      customer: 'CUST-001',
      modeOfPayment: 'M-Pesa STK',
      posProfile: 'POS-001',
      transactionReference: 'TXN-001',
    })));
    await waitFor(() => expect(screen.getByLabelText('Complete sale').props.accessibilityState.disabled).toBe(false));
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

  it('selects and submits a Sales Order delivery date', async () => {
    submit.mockResolvedValue({ doctype: 'Sales Order', name: 'SAL-ORD-0001' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Order"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    expect(screen.getByText('Delivery date')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Choose Sales Order delivery date'));
    await fireEvent(screen.getByTestId('sales-order-delivery-date-picker'), 'valueChange', {}, new Date(2026, 8, 12, 12));

    await fireEvent.press(screen.getByLabelText('Submit sales order'));
    expect(screen.getByText('This will submit the Sales Order for delivery on Sep 12, 2026.')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Confirm sales order submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      deliveryDate: '2026-09-12',
      orderType: 'Order',
      payments: [],
    })));
  });

  it('collects an optional Sales Order advance only when the POS profile permits it', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [{ default: true, mode_of_payment: 'Cash', type: 'Cash' }],
        pos_profile: { allow_sales_order_payments: true, name: 'POS-001' },
      },
      error: null,
      isLoading: false,
      reload: jest.fn(),
    });
    submit.mockResolvedValue({ doctype: 'Sales Order', name: 'SAL-ORD-0002' });
    const screen = await render(
      <PosCheckoutScreen
        currency="KES"
        items={[{ allow_negative_stock: false, available_qty: 4, is_stock_item: true, item_code: 'ITEM-001', item_name: 'Stock item', qty: 1, rate: 100, uom: 'Nos' }]}
        onBack={jest.fn()}
        onComplete={onComplete}
        orderType="Order"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    expect(screen.getByText('Sales Order advance payment')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '40');
    expect(screen.getByText('Advance payment')).toBeTruthy();

    await fireEvent.press(screen.getByLabelText('Submit sales order'));
    expect(screen.getByText(/collect an advance of/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Confirm sales order submission'));

    await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      orderType: 'Order',
      payments: [{ amount: 40, mode_of_payment: 'Cash' }],
    })));
  });

  it('blocks a Sales Order advance above the order total', async () => {
    mockUsePosBootstrap.mockReturnValue({
      data: {
        payment_modes: [{ default: true, mode_of_payment: 'Cash', type: 'Cash' }],
        pos_profile: { allow_sales_order_payments: true, name: 'POS-001' },
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
        orderType="Order"
        saleCustomer={{ customer: 'CUST-001', customerName: 'ABC Corps' }}
        subtotal={100}
      />,
    );

    await fireEvent.changeText(screen.getByLabelText('Cash amount'), '101');

    expect(screen.getByText('An advance cannot exceed the Sales Order total.')).toBeTruthy();
    expect(screen.getByLabelText('Submit sales order').props.accessibilityState.disabled).toBe(true);
  });
});
