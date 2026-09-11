import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { PosNavigationTab } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

const navigationItems = [
  { icon: "home-outline", label: "Home" },
  { icon: "receipt-text-outline", label: "Invoices" },
  { icon: "credit-card-outline", label: "Payments" },
  { icon: "account-group-outline", label: "Customers" },
  { icon: "logout-variant", label: "Close Shift" },
] as const;

type PosBottomNavigationProps = {
  activeTab: PosNavigationTab;
  onTabChange: (tab: PosNavigationTab) => void;
};

function isImplementedTab(label: string): label is PosNavigationTab {
  return label === "Home" || label === "Invoices";
}

/** Only Home and Invoices are interactive in this increment. */
export function PosBottomNavigation({
  activeTab,
  onTabChange,
}: PosBottomNavigationProps) {
  const { palette } = useAppearance();

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.navigation,
        { backgroundColor: palette.surface, borderTopColor: palette.border },
      ]}
    >
      {navigationItems.map(({ icon, label }) => {
        const isActive = label === activeTab;
        const color = isActive ? palette.onPrimary : palette.onSurfaceMuted;
        const itemContent = (
          <>
            <MaterialCommunityIcons color={color} name={icon} size={19} />
            <Text style={[styles.label, { color }]}>{label}</Text>
          </>
        );

        if (isImplementedTab(label)) {
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              key={label}
              onPress={() => onTabChange(label)}
              style={[
                styles.item,
                isActive && { backgroundColor: palette.primary },
              ]}
            >
              {itemContent}
            </Pressable>
          );
        }

        return (
          <View
            accessibilityRole="tab"
            accessibilityState={{ disabled: true }}
            key={label}
            style={styles.item}
          >
            {itemContent}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: "center",
    borderRadius: radii.md,
    flex: 1,
    gap: 2,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 2,
  },
  label: {
    fontFamily: typography.fontFamily.medium,
    fontSize: 10,
  },
  navigation: {
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
});
