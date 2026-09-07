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
  PosInvoiceDetailsScreen: ({ onStartSale }: { onStartSale: (customer: { customer: string; customerName: string }) => void }) => {
    const { Pressable, Text } = require('react-native');
    return <Pressable accessibilityRole="button" onPress={() => onStartSale({ customer: 'CUST-001', customerName: 'Example customer' })}><Text>Start new sale</Text></Pressable>;
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
});
