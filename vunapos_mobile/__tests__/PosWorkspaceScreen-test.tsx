import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/services/NetworkStatusProvider', () => ({
  useNetworkStatus: () => ({ connectionStatus: 'online' }),
}));

jest.mock('@/features/shell/components/AppShell', () => ({
  AppShell: ({ children, onTabChange }: { children: React.ReactNode; onTabChange: (tab: 'Home' | 'Invoices' | 'Customers') => void }) => {
    const { Pressable, Text, View } = require('react-native');

    return (
      <View>
        <Pressable accessibilityRole="button" onPress={() => onTabChange('Invoices')}>
          <Text>Open invoices</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onTabChange('Customers')}>
          <Text>Open customers</Text>
        </Pressable>
        {children}
      </View>
    );
  },
}));

jest.mock('@/features/pos/hooks/usePosCart', () => ({
  usePosCart: () => ({ add: jest.fn(), clear: () => true, error: null, isUpdating: false, itemCount: 0, items: [], refresh: jest.fn(), remove: jest.fn(), retry: jest.fn(), subtotal: 0, taxes: [], totals: {}, updateQuantity: jest.fn() }),
}));

jest.mock('@/features/pos/hooks/useSalespersonPin', () => ({
  useSalespersonPin: () => ({ error: null, isVerifying: false, lock: jest.fn(), session: null, verify: jest.fn() }),
}));

jest.mock('@/features/pos/components/SalespersonPinLock', () => ({
  SalespersonPinLock: () => null,
}));

jest.mock('@/features/pos/screens/PosHomeScreen', () => ({
  PosHomeScreen: ({ onOpenCart, onPosProfileLoaded, pricingContext }: { onOpenCart: () => void; onPosProfileLoaded: (bootstrap: { payment_modes: []; pos_profile: { allow_customer_management?: boolean; name: string }; pos_session?: { has_opening_entry: boolean; ready: boolean; status: 'OPENING_REQUIRED' } }) => void; pricingContext?: { customer?: string } }) => {
    const { Pressable, Text } = require('react-native');
    return <><Text>POS home</Text><Text>{`Catalogue customer: ${pricingContext?.customer || 'none'}`}</Text><Pressable accessibilityRole="button" onPress={onOpenCart}><Text>Open cart</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onPosProfileLoaded({ payment_modes: [], pos_profile: { name: 'POS-001' }, pos_session: { has_opening_entry: false, ready: false, status: 'OPENING_REQUIRED' } })}><Text>Set closed shift session</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onPosProfileLoaded({ payment_modes: [], pos_profile: { allow_customer_management: true, name: 'POS-001' } })}><Text>Enable customer management</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onPosProfileLoaded({ payment_modes: [], pos_profile: { allow_customer_management: false, name: 'POS-001' } })}><Text>Disable customer management</Text></Pressable></>;
  },
}));

jest.mock('@/features/pos/screens/PosCustomersScreen', () => ({
  initialCustomerDirectoryViewState: { filters: { customerGroup: '', customerType: '', territory: '' }, query: '', start: 0 },
  PosCustomersScreen: ({ customerManagementEnabled, directoryState, onDirectoryStateChange, onOpenCustomer }: { customerManagementEnabled: boolean; directoryState: { filters: { customerGroup: string; customerType: '' | 'Company' | 'Individual'; territory: string }; query: string; start: number }; onDirectoryStateChange: (state: { filters: { customerGroup: string; customerType: '' | 'Company' | 'Individual'; territory: string }; query: string; start: number }) => void; onOpenCustomer: (customer: string) => void }) => {
    const { Pressable, Text } = require('react-native');
    return <>
      <Text>{customerManagementEnabled ? 'Customers enabled' : 'Customers disabled'}</Text>
      <Text>{`Customer query: ${directoryState.query}`}</Text>
      <Pressable accessibilityRole="button" onPress={() => onDirectoryStateChange({ ...directoryState, query: 'ABC', start: 0 })}><Text>Search customers</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => onOpenCustomer('CUST-001')}><Text>Open customer</Text></Pressable>
    </>;
  },
}));

jest.mock('@/features/pos/screens/PosCustomerDetailsScreen', () => ({
  PosCustomerDetailsScreen: ({ customer, onBack, onOpenInvoice, onOpenPaymentEntry, onReceivePayment, onStartSale }: { customer: string; onBack: () => void; onOpenInvoice: (invoice: { doctype?: string; name: string }) => void; onOpenPaymentEntry: (payment: { name: string; received_amount: number; unallocated_amount: number }) => void; onReceivePayment: (customer: { customer: string; customerName: string }) => void; onStartSale: (customer: { customer: string; customerName: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    const selectedCustomer = { customer, customerName: 'Directory customer' };
    return <><Text>{`Customer details: ${customer}`}</Text><Pressable accessibilityRole="button" onPress={onBack}><Text>Back to customers</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onStartSale(selectedCustomer)}><Text>Start customer sale</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onReceivePayment(selectedCustomer)}><Text>Receive customer payment</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onOpenInvoice({ doctype: 'Sales Invoice', name: 'ACC-SINV-001' })}><Text>Open customer invoice</Text></Pressable><Pressable accessibilityRole="button" onPress={() => onOpenPaymentEntry({ name: 'ACC-PAY-001', received_amount: 100, unallocated_amount: 0 })}><Text>Open customer payment</Text></Pressable></>;
  },
}));

jest.mock('@/features/pos/screens/PosPaymentsScreen', () => ({
  PosPaymentsScreen: ({ initialReceiveCustomer }: { initialReceiveCustomer?: { customer: string } }) => {
    const { Text } = require('react-native');
    return <Text>{`Payment customer: ${initialReceiveCustomer?.customer || 'none'}`}</Text>;
  },
}));

jest.mock('@/features/pos/screens/PosCartScreen', () => ({
  PosCartScreen: ({ saleCustomer }: { saleCustomer: { customerName: string } | null }) => {
    const { Text } = require('react-native');
    return <Text>{saleCustomer ? `Cart customer: ${saleCustomer.customerName}` : 'Cart has no customer'}</Text>;
  },
}));

jest.mock('@/features/pos/screens/PosInvoicesScreen', () => ({
  PosInvoicesScreen: ({ onBackToPos, onOpenInvoice }: { onBackToPos: () => void; onOpenInvoice: (invoice: { name: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    return <>
      <Pressable accessibilityRole="button" onPress={onBackToPos}><Text>Back to POS</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => onOpenInvoice({ name: 'POS-INV-0001' })}><Text>Open invoice</Text></Pressable>
    </>;
  },
}));

jest.mock('@/features/pos/screens/PosInvoiceDetailsScreen', () => ({
  PosInvoiceDetailsScreen: ({ invoiceName, onBack, onOpenPaymentEntry, onOpenReturn, onStartSale }: { invoiceName: string; onBack: () => void; onOpenPaymentEntry: (paymentEntry: { allocated_amount: number; docstatus: number; name: string; received_amount: number; unallocated_amount: number }, currency: string) => void; onOpenReturn: (invoiceReturn: { name: string }) => void; onStartSale: (customer: { customer: string; customerName: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    return <>
      <Text>{`Invoice details: ${invoiceName}`}</Text>
      <Pressable accessibilityRole="button" onPress={() => onStartSale({ customer: 'CUST-001', customerName: 'Example customer' })}><Text>Start new sale</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => onOpenPaymentEntry({ allocated_amount: 150, docstatus: 1, name: 'ACC-PAY-0001', received_amount: 150, unallocated_amount: 0 }, 'KES')}><Text>Open payment</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => onOpenReturn({ name: 'POS-INV-RET-0001' })}><Text>Open return</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={onBack}><Text>Back to previous invoice</Text></Pressable>
    </>;
  },
}));

jest.mock('@/features/pos/screens/PosPaymentEntryDetailsScreen', () => ({
  PosPaymentEntryDetailsScreen: ({ onBack, paymentEntry }: { onBack: () => void; paymentEntry: { name: string } }) => {
    const { Pressable, Text } = require('react-native');
    return <Pressable accessibilityRole="button" onPress={onBack}><Text>{`Payment details: ${paymentEntry.name}`}</Text></Pressable>;
  },
}));

import { PosWorkspaceScreen } from '@/features/pos/screens/PosWorkspaceScreen';

describe('PosWorkspaceScreen', () => {
  afterEach(async () => {
    await cleanup();
  });

  it('returns from invoice history to the POS home screen', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    expect(screen.getByText('POS home')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open invoices' }));
    expect(screen.getByRole('button', { name: 'Back to POS' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to POS' }));

    expect(screen.getByText('POS home')).toBeTruthy();
  });

  it('starts a fresh POS sale with the invoice customer selected', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Open invoices' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open invoice' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Start new sale' }));

    expect(screen.getByText('POS home')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open cart' }));
    expect(screen.getByText('Cart customer: Example customer')).toBeTruthy();
  });

  it('opens a linked payment and returns to the invoice', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Open invoices' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open invoice' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open payment' }));

    expect(screen.getByText('Payment details: ACC-PAY-0001')).toBeTruthy();
    await fireEvent.press(screen.getByText('Payment details: ACC-PAY-0001'));
    expect(screen.getByRole('button', { name: 'Start new sale' })).toBeTruthy();
  });

  it('opens a linked credit note and returns to the original invoice', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Open invoices' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open invoice' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open return' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Back to previous invoice' }));

    expect(screen.getByRole('button', { name: 'Open return' })).toBeTruthy();
  });

  it('blocks the POS workspace when the current session is not ready for sales', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Set closed shift session' }));

    expect(screen.getByText('A new POS shift is required')).toBeTruthy();
  });

  it('opens the Customer tab only after the POS Profile enables customer management', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    expect(screen.getByText('Customers enabled')).toBeTruthy();
  });

  it('keeps a reached Customer tab in its disabled state when the profile denies management', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Disable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    expect(screen.getByText('Customers disabled')).toBeTruthy();
  });

  it('returns to the Customer directory with its current view state after opening a customer', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Search customers' }));
    expect(screen.getByText('Customer query: ABC')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Open customer' }));
    expect(screen.getByText('Customer details: CUST-001')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back to customers' }));

    expect(screen.getByText('Customer query: ABC')).toBeTruthy();
  });

  it('starts a fresh customer sale with the customer-aware catalogue context', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Start customer sale' }));

    expect(screen.getByText('POS home')).toBeTruthy();
    expect(screen.getByText('Catalogue customer: CUST-001')).toBeTruthy();
  });

  it('opens Receive payment with the selected directory customer', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Receive customer payment' }));

    expect(screen.getByText('Payment customer: CUST-001')).toBeTruthy();
  });

  it('opens a customer invoice and returns to the same customer detail', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer invoice' }));
    expect(screen.getByText('Invoice details: ACC-SINV-001')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Back to previous invoice' }));
    expect(screen.getByText('Customer details: CUST-001')).toBeTruthy();
  });

  it('opens a customer payment and returns to the same customer detail', async () => {
    const screen = await render(<PosWorkspaceScreen />);

    await fireEvent.press(screen.getByRole('button', { name: 'Enable customer management' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customers' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open customer payment' }));
    expect(screen.getByText('Payment details: ACC-PAY-001')).toBeTruthy();

    await fireEvent.press(screen.getByText('Payment details: ACC-PAY-001'));
    expect(screen.getByText('Customer details: CUST-001')).toBeTruthy();
  });
});
