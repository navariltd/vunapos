import { useEffect, useRef, useState } from "react";
import {
  FlatList,
  ListRenderItem,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { PosCartButton } from "@/features/pos/components/PosCartButton";
import { PosBarcodeScannerModal } from "@/features/pos/components/PosBarcodeScannerModal";
import { PosItemCard } from "@/features/pos/components/PosItemCard";
import { PosItemSearch } from "@/features/pos/components/PosItemSearch";
import { usePosBarcodeScan } from "@/features/pos/hooks/usePosBarcodeScan";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosItemSearch } from "@/features/pos/hooks/usePosItemSearch";
import { PosBootstrapData, PosCatalogueItem } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

function matchesSearch(item: PosCatalogueItem, searchTerm: string) {
  const normalizedItem =
    `${item.item_name} ${item.item_code} ${item.barcode || ""}`.toLowerCase();
  return normalizedItem.includes(searchTerm.trim().toLowerCase());
}

type PosHomeScreenProps = {
  cartItemCount: number;
  onAddToCart: (item: PosCatalogueItem, currency: string) => void;
  onOpenCart: () => void;
  onPosProfileLoaded: (bootstrap: PosBootstrapData) => void;
  pricingContext?: { customer?: string; priceList?: string };
  refreshKey?: number;
};

export function PosHomeScreen({
  cartItemCount,
  onAddToCart,
  onOpenCart,
  onPosProfileLoaded,
  pricingContext,
  refreshKey = 0,
}: PosHomeScreenProps) {
  const { palette } = useAppearance();
  const [searchQuery, setSearchQuery] = useState("");
  const [barcodeScannerVisible, setBarcodeScannerVisible] = useState(false);
  const bootstrap = usePosBootstrap();
  const itemSearch = usePosItemSearch({
    customer: pricingContext?.customer,
    loadAll: Boolean(pricingContext?.customer || pricingContext?.priceList),
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
    query: searchQuery,
  });
  const bootstrapItems = bootstrap.data?.items ?? [];
  const localMatches = bootstrapItems.filter((item) =>
    matchesSearch(item, searchQuery),
  );
  const items =
    searchQuery.trim() || itemSearch.hasLoaded
      ? itemSearch.items
      : localMatches;
  const currency = bootstrap.data?.pos_profile.currency || "KES";
  const currencyPrecision = bootstrap.data?.pos_profile.currency_precision ?? 2;
  const barcodeScan = usePosBarcodeScan({
    customer: pricingContext?.customer,
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
  });
  const handledRefreshKey = useRef(refreshKey);
  const reloadBootstrap = bootstrap.reload;

  useEffect(() => {
    if (bootstrap.data) onPosProfileLoaded(bootstrap.data);
  }, [bootstrap.data, onPosProfileLoaded]);

  useEffect(() => {
    if (handledRefreshKey.current === refreshKey) return;
    handledRefreshKey.current = refreshKey;
    reloadBootstrap();
  }, [refreshKey, reloadBootstrap]);

  function addItem(item: PosCatalogueItem) {
    const outOfStock =
      Boolean(item.is_stock_item) &&
      !item.allow_negative_stock &&
      Number(item.actual_qty || 0) <= 0;
    if (outOfStock) return;
    onAddToCart(item, currency);
  }

  async function scanBarcode(barcode: string) {
    const result = await barcodeScan.resolve(barcode);
    if (!result.ok) return result.message;
    const item = result.item;
    const outOfStock =
      Boolean(item.is_stock_item) &&
      !item.allow_negative_stock &&
      Number(item.actual_qty || 0) <= 0;
    if (outOfStock)
      return `${item.item_name || item.item_code} is out of stock.`;
    setSearchQuery("");
    onAddToCart(item, currency);
    return null;
  }

  const renderItem: ListRenderItem<PosCatalogueItem> = ({ item }) => (
    <PosItemCard
      currency={currency}
      currencyPrecision={currencyPrecision}
      item={item}
      onAdd={addItem}
    />
  );

  if (bootstrap.isLoading)
    return (
      <View style={styles.state}>
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading your POS catalogue…
        </Text>
      </View>
    );
  if (bootstrap.error || !bootstrap.data) {
    return (
      <View style={styles.state}>
        <Text style={[styles.errorText, { color: palette.error }]}>
          {bootstrap.error || "Could not load the POS catalogue."}
        </Text>
        <Pressable
          accessibilityLabel="Retry loading POS catalogue"
          onPress={bootstrap.reload}
          style={[styles.retryButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.retryButtonLabel, { color: palette.onSurface }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.content}>
      <FlatList
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        data={items}
        keyExtractor={(item) => item.item_code}
        ListEmptyComponent={
          <Text
            style={[
              styles.emptyState,
              {
                color: itemSearch.error
                  ? palette.error
                  : palette.onSurfaceMuted,
              },
            ]}
          >
            {itemSearch.isLoading
              ? "Searching the catalogue…"
              : itemSearch.error ||
                "No items found. Try another item name, code, or barcode."}
          </Text>
        }
        ListHeaderComponent={
          <View>
            <PosItemSearch
              onChangeText={setSearchQuery}
              onScanBarcode={() => setBarcodeScannerVisible(true)}
              value={searchQuery}
            />
          </View>
        }
        numColumns={2}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
      <PosCartButton itemCount={cartItemCount} onPress={onOpenCart} />
      <PosBarcodeScannerModal
        isResolving={barcodeScan.isResolving}
        onClose={() => setBarcodeScannerVisible(false)}
        onScan={scanBarcode}
        visible={barcodeScannerVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: "relative",
  },
  emptyState: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xxl,
    textAlign: "center",
  },
  errorText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  listContent: {
    paddingBottom: 88,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  retryButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  state: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.xl,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
});
