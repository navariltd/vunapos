import { MaterialCommunityIcons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { PosCatalogueItem } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosItemListRowProps = {
  currency: string;
  currencyPrecision?: number;
  isAdding?: boolean;
  isOffline?: boolean;
  item: PosCatalogueItem;
  onAdd: (item: PosCatalogueItem) => void;
};

function taxLabel(item: PosCatalogueItem) {
  const rate = item.item_tax?.inclusive
    ? item.item_tax.inclusive_tax_rate
    : item.item_tax?.exclusive_tax_rate;
  if (rate !== undefined && rate !== null)
    return `Tax ${item.item_tax?.inclusive ? "incl." : "excl."} · ${rate}%`;
  return "Tax at checkout";
}

/** Compact profile-controlled catalogue presentation that retains full add context. */
export function PosItemListRow({
  currency,
  currencyPrecision = 2,
  isAdding = false,
  isOffline = false,
  item,
  onAdd,
}: PosItemListRowProps) {
  const { palette } = useAppearance();
  const outOfStock =
    Boolean(item.is_stock_item) &&
    !item.has_variants &&
    !item.is_product_bundle &&
    !item.allow_negative_stock &&
    Number(item.actual_qty || 0) <= 0;

  return (
    <Pressable
      accessibilityHint={
        isOffline
          ? "Reconnect to add items"
          : outOfStock
          ? "This item is out of stock"
          : isAdding
            ? "This item is being added to the cart"
            : "Adds this item to the cart"
      }
      accessibilityLabel={
        isAdding ? `Adding ${item.item_name}` : `Add ${item.item_name}`
      }
    disabled={outOfStock || isAdding || isOffline}
      onPress={() => onAdd(item)}
      style={[
        styles.row,
        {
          backgroundColor: palette.surface,
          borderColor: palette.borderSubtle,
          opacity: outOfStock || isAdding || isOffline ? 0.72 : 1,
        },
      ]}
    >
      <View style={styles.details}>
        <Text
          numberOfLines={1}
          style={[styles.name, { color: palette.onSurface }]}
        >
          {item.item_name}
        </Text>
        {item.is_product_bundle ? (
          <Text
            style={[
              styles.bundleBadge,
              {
                backgroundColor: palette.surfaceContainerHigh,
                color: palette.onSurface,
              },
            ]}
          >
            Bundle
          </Text>
        ) : null}
        <Text
          numberOfLines={1}
          style={[styles.meta, { color: palette.onSurfaceMuted }]}
        >
          {item.item_code}
          {item.stock_uom ? ` · ${item.stock_uom}` : ""}
        </Text>
        <Text style={[styles.meta, { color: palette.onSurfaceMuted }]}>
          {taxLabel(item)}
        </Text>
      </View>
      <View style={styles.priceArea}>
        <Text style={[styles.price, { color: palette.onSurface }]}>
          {formatPosCurrency(
            Number(item.rate || 0),
            currency,
            currencyPrecision,
          )}
        </Text>
        <Text
          style={[
            styles.quantity,
            { color: outOfStock ? palette.error : palette.onSurfaceMuted },
          ]}
        >
          {outOfStock
            ? "Out of stock"
            : item.is_stock_item
              ? `Qty ${Number(item.actual_qty || 0)}`
              : "Non-stock item"}
        </Text>
      </View>
      <View
        style={[
          styles.addButton,
          {
            backgroundColor:
              outOfStock || isAdding || isOffline
                ? palette.disabled
                : palette.primary,
          },
        ]}
      >
        {isAdding ? (
          <ActivityIndicator color={palette.onPrimary} size="small" />
        ) : (
          <MaterialCommunityIcons
            color={palette.onPrimary}
            name="plus"
            size={19}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  bundleBadge: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.4,
    marginTop: 2,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    textTransform: "uppercase",
  },
  details: { flex: 1, gap: 2, minWidth: 0 },
  meta: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  name: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  price: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  priceArea: { alignItems: "flex-end", gap: 2, minWidth: 84 },
  quantity: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  row: {
    alignItems: "center",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
