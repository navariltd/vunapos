import { cleanup, fireEvent, render } from '@testing-library/react-native';

jest.mock('@/features/shell/components/AppShell', () => ({
  AppShell: ({ children, onTabChange }: { children: React.ReactNode; onTabChange: (tab: 'Home' | 'Invoices') => void }) => {
    const { Pressable, Text, View } = require('react-native');

    return (
      <View>
        <Pressable accessibilityRole="button" onPress={() => onTabChange('Invoices')}>
          <Text>Open invoices</Text>
        </Pressable>
        {children}
      </View>
    );
  },
}));

jest.mock('@/features/pos/screens/PosHomeScreen', () => ({
  PosHomeScreen: ({ saleCustomer }: { saleCustomer: { customerName: string } | null }) => {
    const { Text } = require('react-native');
    return <><Text>POS home</Text><Text>{saleCustomer ? `Sale customer: ${saleCustomer.customerName}` : 'No sale customer'}</Text></>;
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
  PosInvoiceDetailsScreen: ({ onBack, onOpenPaymentEntry, onOpenReturn, onStartSale }: { onBack: () => void; onOpenPaymentEntry: (paymentEntry: { allocated_amount: number; docstatus: number; name: string; received_amount: number; unallocated_amount: number }, currency: string) => void; onOpenReturn: (invoiceReturn: { name: string }) => void; onStartSale: (customer: { customer: string; customerName: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    return <>
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
    expect(screen.getByText('Sale customer: Example customer')).toBeTruthy();
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
});
