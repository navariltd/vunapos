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
  PosHomeScreen: () => {
    const { Text } = require('react-native');
    return <Text>POS home</Text>;
  },
}));

jest.mock('@/features/pos/screens/PosInvoicesScreen', () => ({
  PosInvoicesScreen: ({ onBackToPos }: { onBackToPos: () => void }) => {
    const { Pressable, Text } = require('react-native');
    return <Pressable accessibilityRole="button" onPress={onBackToPos}><Text>Back to POS</Text></Pressable>;
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
});
