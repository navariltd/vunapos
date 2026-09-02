import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { Screen } from '@/components/layout/Screen';
import { PosBottomNavigation } from '@/features/pos/components/PosBottomNavigation';
import { PosTopBar } from '@/features/pos/components/PosTopBar';
import { PosNavigationTab, PosOrderType } from '@/features/pos/types';
import { posDarkColors } from '@/theme/tokens';

type AppShellProps = PropsWithChildren<{
  activeTab: PosNavigationTab;
  onOrderTypeChange: (orderType: PosOrderType) => void;
  onTabChange: (tab: PosNavigationTab) => void;
  orderType: PosOrderType;
}>;

export function AppShell({ activeTab, children, onOrderTypeChange, onTabChange, orderType }: AppShellProps) {
  return (
    <Screen style={styles.screen}>
      <StatusBar style="light" />
      <PosTopBar onOrderTypeChange={onOrderTypeChange} orderType={orderType} />
      <View style={styles.content}>{children}</View>
      <PosBottomNavigation activeTab={activeTab} onTabChange={onTabChange} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
  },
  screen: {
    backgroundColor: posDarkColors.background,
  },
});
