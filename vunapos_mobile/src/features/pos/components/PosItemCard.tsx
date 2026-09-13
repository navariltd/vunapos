import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { PosCatalogueItem } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosItemCardProps = {
  currency: string;
  currencyPrecision?: number;
  imageUrl?: string | null;
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

function quantityLabel(item: PosCatalogueItem) {
  if (!item.is_stock_item) return "Non-stock item";
  return `Qty ${Number(item.actual_qty || 0)}`;
}

export function PosItemCard({
  currency,
  currencyPrecision = 2,
  imageUrl,
  isAdding = false,
  isOffline = false,
  item,
  onAdd,
}: PosItemCardProps) {
  const { palette } = useAppearance();
  const outOfStock =
    Boolean(item.is_stock_item) &&
    !item.has_variants &&
    !item.is_product_bundle &&
    !item.allow_negative_stock &&
    Number(item.actual_qty || 0) <= 0;

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Pressable
        accessibilityHint={
          isOffline
            ? "Reconnect to add items"
            : outOfStock
            ? "This item is out of stock"
            : "Adds this item to the cart"
        }
        accessibilityLabel={item.item_name}
        disabled={outOfStock || isAdding || isOffline}
        onPress={() => onAdd(item)}
        style={[
          styles.previewArea,
          { backgroundColor: palette.surfaceContainer },
        ]}
      >
        {imageUrl ? (
          <Image
            accessibilityLabel={`${item.item_name} image`}
            resizeMode="cover"
            source={{ uri: imageUrl }}
            style={styles.previewImage}
            testID={`Item image ${item.item_code}`}
          />
        ) : (
          <Text
            numberOfLines={2}
            style={[styles.previewName, { color: palette.onSurfaceMuted }]}
          >
            {item.item_name}
          </Text>
        )}
      </Pressable>
      {item.is_product_bundle ? (
        <View
          pointerEvents="none"
          style={[
            styles.bundleBadge,
            { backgroundColor: palette.surfaceContainerHigh },
          ]}
        >
          <Text style={[styles.bundleBadgeText, { color: palette.onSurface }]}>
            Bundle
          </Text>
        </View>
      ) : null}

      <View style={styles.details}>
        <Text
          numberOfLines={2}
          style={[styles.itemName, { color: palette.onSurface }]}
        >
          {item.item_name}
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.itemCode, { color: palette.onSurfaceMuted }]}
        >
          {item.item_code}
        </Text>
        <View style={styles.purchaseRow}>
          <View style={styles.priceArea}>
            <Text style={[styles.taxLabel, { color: palette.onSurfaceMuted }]}>
              {taxLabel(item)}
            </Text>
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
              {outOfStock ? "Out of stock" : quantityLabel(item)}
            </Text>
          </View>
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
                size={18}
              />
            )}
          </Pressable>
        </View>
      </View>
    </View>
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
    borderBottomRightRadius: radii.md,
    left: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    position: "absolute",
    top: 0,
  },
  bundleBadgeText: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 254,
    overflow: "hidden",
  },
  details: {
    flex: 1,
    gap: 4,
    padding: spacing.sm,
  },
  itemCode: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  itemName: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
  },
  previewArea: {
    alignItems: "center",
    height: 128,
    justifyContent: "center",
    padding: spacing.md,
  },
  previewImage: {
    height: "100%",
    width: "100%",
  },
  previewName: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
    textAlign: "center",
  },
  price: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 15,
    lineHeight: 18,
  },
  priceArea: {
    flex: 1,
  },
  purchaseRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: "auto",
  },
  quantity: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  taxLabel: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
});
