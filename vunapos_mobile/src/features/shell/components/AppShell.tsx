import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { Screen } from "@/components/layout/Screen";
import { NetworkStatusBanner } from "@/components/network/NetworkStatusBanner";
import { PosBottomNavigation } from "@/features/pos/components/PosBottomNavigation";
import { PosTopBar } from "@/features/pos/components/PosTopBar";
import { PosNavigationTab, PosOrderType } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";

type AppShellProps = PropsWithChildren<{
  activeTab: PosNavigationTab;
  onOrderTypeChange: (orderType: PosOrderType) => void;
  onTabChange: (tab: PosNavigationTab) => void;
  orderType: PosOrderType;
  paymentsEnabled?: boolean;
}>;

export function AppShell({
  activeTab,
  children,
  onOrderTypeChange,
  onTabChange,
  orderType,
  paymentsEnabled,
}: AppShellProps) {
  const { palette } = useAppearance();
  return (
    <Screen style={{ backgroundColor: palette.background }}>
      <PosTopBar onOrderTypeChange={onOrderTypeChange} orderType={orderType} />
      <NetworkStatusBanner />
      <View style={styles.content}>{children}</View>
      <PosBottomNavigation
        activeTab={activeTab}
        onTabChange={onTabChange}
        paymentsEnabled={paymentsEnabled}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({ content: { flex: 1 } });
