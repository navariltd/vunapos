import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosCatalogueItem } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosItemCardProps = {
  currency: string;
  item: PosCatalogueItem;
  onAdd: (item: PosCatalogueItem) => void;
};

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2, style: 'currency' }).format(amount);
}

function taxLabel(item: PosCatalogueItem) {
  const rate = item.item_tax?.inclusive ? item.item_tax.inclusive_tax_rate : item.item_tax?.exclusive_tax_rate;
  if (rate !== undefined && rate !== null) return `Tax ${item.item_tax?.inclusive ? 'incl.' : 'excl.'} · ${rate}%`;
  return 'Tax at checkout';
}

function quantityLabel(item: PosCatalogueItem) {
  if (!item.is_stock_item) return 'Non-stock item';
  return `Qty ${Number(item.actual_qty || 0)}`;
}

export function PosItemCard({ currency, item, onAdd }: PosItemCardProps) {
  const outOfStock = Boolean(item.is_stock_item) && !item.allow_negative_stock && Number(item.actual_qty || 0) <= 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityHint={outOfStock ? 'This item is out of stock' : 'Adds this item to the cart'}
        accessibilityLabel={item.item_name}
        disabled={outOfStock}
        onPress={() => onAdd(item)}
        style={styles.previewArea}
      >
        <Text numberOfLines={2} style={styles.previewName}>{item.item_name}</Text>
      </Pressable>

      <View style={styles.details}>
        <Text numberOfLines={2} style={styles.itemName}>{item.item_name}</Text>
        <Text numberOfLines={1} style={styles.itemCode}>{item.item_code}</Text>
        <View style={styles.purchaseRow}>
          <View style={styles.priceArea}>
            <Text style={styles.taxLabel}>{taxLabel(item)}</Text>
            <Text style={styles.price}>{formatCurrency(Number(item.rate || 0), currency)}</Text>
            <Text style={[styles.quantity, outOfStock && styles.outOfStock]}>{outOfStock ? 'Out of stock' : quantityLabel(item)}</Text>
          </View>
          <Pressable
            accessibilityHint={outOfStock ? 'This item is out of stock' : 'Adds this item to the cart'}
            accessibilityLabel={`Add ${item.item_name}`}
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
