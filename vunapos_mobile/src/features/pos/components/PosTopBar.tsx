import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { WorkspaceSettingsSheet } from "@/features/shell/components/WorkspaceSettingsSheet";
import { useAppSession } from "@/features/auth/AppSessionProvider";
import { PosOrderType } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosTopBarProps = {
  orderType: PosOrderType;
  onLocalDataCleared: () => void;
  onOrderTypeChange: (orderType: PosOrderType) => void;
};

export function PosTopBar({
  orderType,
  onLocalDataCleared,
  onOrderTypeChange,
}: PosTopBarProps) {
  const [settingsVisible, setSettingsVisible] = useState(false);
  const { clearLocalPosData } = useAppSession();
  const { palette } = useAppearance();

  function selectOrderType(nextOrderType: PosOrderType) {
    onOrderTypeChange(nextOrderType);
    setSettingsVisible(false);
  }

  async function clearSavedPosData() {
    await clearLocalPosData();
    onLocalDataCleared();
  }

  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: palette.surface, borderBottomColor: palette.border },
      ]}
    >
      <Text style={[styles.brand, { color: palette.onSurface }]}>VunaPOS</Text>
      <Pressable
        accessibilityLabel="Open workspace settings"
        onPress={() => setSettingsVisible(true)}
        style={[
          styles.profileButton,
          {
            borderColor: palette.border,
            backgroundColor: palette.surfaceContainer,
          },
        ]}
      >
        <MaterialCommunityIcons
          color={palette.onSurface}
          name="account-circle-outline"
          size={24}
        />
      </Pressable>
      <WorkspaceSettingsSheet
        onClose={() => setSettingsVisible(false)}
        onClearLocalData={clearSavedPosData}
        onOrderTypeChange={selectOrderType}
        orderType={orderType}
        visible={settingsVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    height: 48,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  brand: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  profileButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    flexDirection: "row",
    height: 34,
    justifyContent: "center",
    width: 34,
  },
});
