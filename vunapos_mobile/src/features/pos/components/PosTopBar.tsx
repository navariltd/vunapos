import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Menu, Text } from 'react-native-paper';

import { PosOrderType } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosTopBarProps = {
  orderType: PosOrderType;
  onOrderTypeChange: (orderType: PosOrderType) => void;
};

export function PosTopBar({ orderType, onOrderTypeChange }: PosTopBarProps) {
  const [menuVisible, setMenuVisible] = useState(false);

  function selectOrderType(nextOrderType: PosOrderType) {
    onOrderTypeChange(nextOrderType);
    setMenuVisible(false);
  }

  return (
    <View style={styles.bar}>
      <Text style={styles.brand}>VunaPOS</Text>
      <Menu
        anchor={(
          <Pressable
            accessibilityHint="Choose the document type for this sale"
            accessibilityLabel={`Order type: ${orderType}`}
            accessibilityRole="button"
            onPress={() => setMenuVisible(true)}
            style={styles.orderTypeButton}
          >
            <Text style={styles.orderTypeLabel}>{orderType}</Text>
            <MaterialCommunityIcons color={posDarkColors.onSurfaceMuted} name="chevron-down" size={18} />
          </Pressable>
        )}
        contentStyle={styles.menuContent}
        onDismiss={() => setMenuVisible(false)}
        visible={menuVisible}
      >
        <Menu.Item onPress={() => selectOrderType('Invoice')} title="Invoice" titleStyle={styles.menuItemLabel} />
        <Menu.Item onPress={() => selectOrderType('Order')} title="Order" titleStyle={styles.menuItemLabel} />
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surface,
    borderBottomColor: posDarkColors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 48,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
  },
  brand: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  menuContent: {
    backgroundColor: posDarkColors.surfaceContainerHigh,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  menuItemLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.medium,
  },
  orderTypeButton: {
    alignItems: 'center',
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    height: 34,
    paddingHorizontal: spacing.sm,
  },
  orderTypeLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
});
