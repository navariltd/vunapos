import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

const navigationItems = [
  { icon: 'home-outline', label: 'Home' },
  { icon: 'receipt-text-outline', label: 'Invoices' },
  { icon: 'credit-card-outline', label: 'Payments' },
  { icon: 'account-group-outline', label: 'Customers' },
  { icon: 'logout-variant', label: 'Close Shift' },
] as const;

/** Visual shell only. Route handling for tabs is deliberately deferred. */
export function PosBottomNavigation() {
  return (
    <View accessibilityRole="tablist" style={styles.navigation}>
      {navigationItems.map(({ icon, label }) => {
        const isActive = label === 'Home';
        const color = isActive ? posDarkColors.onPrimary : posDarkColors.onSurfaceMuted;

        return (
          <View accessibilityRole="tab" accessibilityState={{ selected: isActive }} key={label} style={[styles.item, isActive && styles.activeItem]}>
            <MaterialCommunityIcons color={color} name={icon} size={19} />
            <Text style={[styles.label, isActive && styles.activeLabel]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  activeItem: {
    backgroundColor: posDarkColors.primary,
  },
  activeLabel: {
    color: posDarkColors.onPrimary,
  },
  item: {
    alignItems: 'center',
    borderRadius: radii.md,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 2,
  },
  label: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: 10,
  },
  navigation: {
    backgroundColor: posDarkColors.surface,
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
});
