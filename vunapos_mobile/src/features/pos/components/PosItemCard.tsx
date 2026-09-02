import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosPreviewItem } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosItemCardProps = {
  item: PosPreviewItem;
  onAdd: (item: PosPreviewItem) => void;
};

function formatCurrency(amount: number) {
  return `KES ${amount.toFixed(2)}`;
}

export function PosItemCard({ item, onAdd }: PosItemCardProps) {
  const outOfStock = item.quantity <= 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityHint={outOfStock ? 'This item is out of stock' : 'Adds this item to the cart'}
        accessibilityLabel={item.itemName}
        disabled={outOfStock}
        onPress={() => onAdd(item)}
        style={styles.previewArea}
      >
        <Text numberOfLines={2} style={styles.previewName}>{item.itemName}</Text>
      </Pressable>

      <View style={styles.details}>
        <Text numberOfLines={2} style={styles.itemName}>{item.itemName}</Text>
        <Text numberOfLines={1} style={styles.itemCode}>{item.itemCode}</Text>
        <View style={styles.purchaseRow}>
          <View style={styles.priceArea}>
            <Text style={styles.taxLabel}>{item.taxLabel}</Text>
            <Text style={styles.price}>{formatCurrency(item.price)}</Text>
            <Text style={[styles.quantity, outOfStock && styles.outOfStock]}>{outOfStock ? 'Out of stock' : `Qty ${item.quantity}`}</Text>
          </View>
          <Pressable
            accessibilityHint={outOfStock ? 'This item is out of stock' : 'Adds this item to the cart'}
            accessibilityLabel={`Add ${item.itemName}`}
            disabled={outOfStock}
            onPress={() => onAdd(item)}
            style={[styles.addButton, outOfStock && styles.addButtonDisabled]}
          >
            <MaterialCommunityIcons color={posDarkColors.onPrimary} name="plus" size={18} />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    backgroundColor: posDarkColors.primary,
    borderRadius: radii.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  addButtonDisabled: {
    backgroundColor: posDarkColors.disabled,
  },
  card: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 254,
    overflow: 'hidden',
  },
  details: {
    flex: 1,
    gap: 4,
    padding: spacing.sm,
  },
  itemCode: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  itemName: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
  },
  outOfStock: {
    color: posDarkColors.error,
  },
  previewArea: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surfaceContainer,
    height: 128,
    justifyContent: 'center',
    padding: spacing.md,
  },
  previewName: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
    textAlign: 'center',
  },
  price: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 15,
    lineHeight: 18,
  },
  priceArea: {
    flex: 1,
  },
  purchaseRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 'auto',
  },
  quantity: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  taxLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
});
