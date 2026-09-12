import { useCallback, useEffect, useRef, useState } from "react";
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
import { PosItemListRow } from "@/features/pos/components/PosItemListRow";
import { PosItemSearch } from "@/features/pos/components/PosItemSearch";
import { PosProductBundleSheet } from "@/features/pos/components/PosProductBundleSheet";
import { PosVariantPickerSheet } from "@/features/pos/components/PosVariantPickerSheet";
import { usePosBarcodeScan } from "@/features/pos/hooks/usePosBarcodeScan";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosItemSearch } from "@/features/pos/hooks/usePosItemSearch";
import { usePosProductBundle } from "@/features/pos/hooks/usePosProductBundle";
import { usePosTemplateVariants } from "@/features/pos/hooks/usePosTemplateVariants";
import { useAppSession } from "@/features/auth/AppSessionProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  PosBootstrapData,
  PosCatalogueItem,
  PosTemplateVariant,
} from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

function matchesSearch(item: PosCatalogueItem, searchTerm: string) {
  const normalizedItem =
    `${item.item_name} ${item.item_code} ${item.barcode || ""}`.toLowerCase();
  return normalizedItem.includes(searchTerm.trim().toLowerCase());
}

function itemImageUrl(
  image: string | null | undefined,
  companyUrl?: string | null,
) {
  if (!image?.trim()) return null;
  if (/^https?:\/\//i.test(image)) return image;
  if (!companyUrl) return null;

  try {
    return new URL(image, `${companyUrl.replace(/\/+$/, "")}/`).toString();
  } catch {
    return null;
  }
}

type PosHomeScreenProps = {
  cartItemCount: number;
  onAddToCart: (
    item: PosCatalogueItem,
    currency: string,
  ) => Promise<boolean | void> | boolean | void;
  onOpenCart: () => void;
  onPosProfileLoaded: (bootstrap: PosBootstrapData) => void;
  pricingContext?: { customer?: string; priceList?: string };
  refreshKey?: number;
  workspaceNotice?: string | null;
};

export function PosHomeScreen({
  cartItemCount,
  onAddToCart,
  onOpenCart,
  onPosProfileLoaded,
  pricingContext,
  refreshKey = 0,
  workspaceNotice,
}: PosHomeScreenProps) {
  const { palette } = useAppearance();
  const { companyUrl } = useAppSession();
  const { connectionStatus } = useNetworkStatus();
  const isOffline = connectionStatus === "offline";
  const [searchQuery, setSearchQuery] = useState("");
  const [barcodeScannerVisible, setBarcodeScannerVisible] = useState(false);
  const [pendingItemCode, setPendingItemCode] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [catalogueNotice, setCatalogueNotice] = useState<string | null>(null);
  const [variantTemplate, setVariantTemplate] =
    useState<PosCatalogueItem | null>(null);
  const [variantActionError, setVariantActionError] = useState<string | null>(
    null,
  );
  const [bundleItem, setBundleItem] = useState<PosCatalogueItem | null>(null);
  const bootstrap = usePosBootstrap();
  const itemSearch = usePosItemSearch({
    customer: pricingContext?.customer,
    enabled: !isOffline,
    // Bootstrap intentionally returns only the first catalogue page. Keep it
    // visible for first paint, then replace it with the complete live
    // profile/customer/price-list catalogue when this request resolves.
    loadAll: true,
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
    query: searchQuery,
  });
  const bootstrapItems = bootstrap.data?.items ?? [];
  const cachedItems = itemSearch.cachedItems ?? [];
  const localItems =
    cachedItems.length > 0
      ? cachedItems
      : bootstrapItems;
  const localMatches = localItems.filter((item) =>
    matchesSearch(item, searchQuery),
  );
  const items =
    isOffline || (!searchQuery.trim() && !itemSearch.hasLoaded)
      ? localMatches
      : itemSearch.items;
  const currency = bootstrap.data?.pos_profile.currency || "KES";
  const currencyPrecision = bootstrap.data?.pos_profile.currency_precision ?? 2;
  const hideImages = Boolean(bootstrap.data?.pos_profile.hide_images);
  const hideUnavailableItems = Boolean(
    bootstrap.data?.pos_profile.hide_unavailable_items,
  );
  const barcodeScan = usePosBarcodeScan({
    customer: pricingContext?.customer,
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
  });
  const templateVariants = usePosTemplateVariants({
    customer: pricingContext?.customer,
    enabled: Boolean(variantTemplate) && !isOffline,
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
    templateItemCode: variantTemplate?.item_code,
  });
  const productBundle = usePosProductBundle({
    customer: pricingContext?.customer,
    enabled: Boolean(bundleItem) && !isOffline,
    itemCode: bundleItem?.item_code,
    posProfile: bootstrap.data?.pos_profile.name,
    priceList: pricingContext?.priceList,
  });
  const handledRefreshKey = useRef(refreshKey);
  const autoAddedSearchKey = useRef<string | null>(null);
  const reloadBootstrap = bootstrap.reload;
  const reloadCatalogue = itemSearch.reload;

  useEffect(() => {
    if (bootstrap.data) onPosProfileLoaded(bootstrap.data);
  }, [bootstrap.data, onPosProfileLoaded]);

  useEffect(() => {
    if (handledRefreshKey.current === refreshKey) return;
    handledRefreshKey.current = refreshKey;
    if (!isOffline) {
      reloadBootstrap();
      reloadCatalogue();
    }
  }, [isOffline, refreshKey, reloadBootstrap, reloadCatalogue]);

  const isOutOfStock = useCallback(
    (item: PosCatalogueItem) =>
      Boolean(item.is_stock_item) &&
      !item.has_variants &&
      !item.is_product_bundle &&
      !item.allow_negative_stock &&
      Number(item.actual_qty || 0) <= 0,
    [],
  );

  const visibleItems = hideUnavailableItems
    ? items.filter((item) => !isOutOfStock(item))
    : items;

  const addItem = useCallback(
    async (item: PosCatalogueItem): Promise<boolean> => {
      if (isOffline) {
        setAddError("Connection unavailable. Reconnect to add items.");
        return false;
      }
      if (pendingItemCode) return false;
      if (item.has_variants) {
        setVariantActionError(null);
        setVariantTemplate(item);
        return true;
      }
      if (item.is_product_bundle) {
        setBundleItem(item);
        return true;
      }
      const outOfStock = isOutOfStock(item);
      if (outOfStock) return false;

      setAddError(null);
      setPendingItemCode(item.item_code);
      try {
        const added = await onAddToCart(item, currency);
        if (added === false) {
          setAddError(`Could not add ${item.item_name}. Please try again.`);
          return false;
        }
        return true;
      } catch {
        setAddError(`Could not add ${item.item_name}. Please try again.`);
        return false;
      } finally {
        setPendingItemCode(null);
      }
    },
    [currency, isOffline, isOutOfStock, onAddToCart, pendingItemCode],
  );

  useEffect(() => {
    const searchTerm = searchQuery.trim();
    const candidate = visibleItems.length === 1 ? visibleItems[0] : null;
    const searchKey = candidate
      ? `${searchTerm}:${candidate.item_code}:${pricingContext?.customer || ""}:${pricingContext?.priceList || ""}`
      : null;
    if (
      !bootstrap.data?.pos_profile.automatically_add_filtered_item_to_cart ||
      !searchTerm ||
      !candidate ||
      isOffline ||
      itemSearch.isLoading ||
      pendingItemCode ||
      autoAddedSearchKey.current === searchKey
    ) {
      if (!searchTerm || !candidate) autoAddedSearchKey.current = null;
      return;
    }
    autoAddedSearchKey.current = searchKey;
    void addItem(candidate);
  }, [
    addItem,
    bootstrap.data?.pos_profile.automatically_add_filtered_item_to_cart,
    itemSearch.isLoading,
    isOffline,
    visibleItems,
    pendingItemCode,
    pricingContext?.customer,
    pricingContext?.priceList,
    searchQuery,
  ]);

  async function selectVariant(variant: PosTemplateVariant) {
    setVariantActionError(null);
    const added = await addItem(variant);
    if (added) setVariantTemplate(null);
    else
      setVariantActionError(
        `Could not add ${variant.item_name || variant.item_code}. Please try again.`,
      );
  }

  async function confirmBundle() {
    if (!bundleItem) return;
    const bundle = bundleItem;
    setBundleItem(null);
    await addItem({ ...bundle, is_product_bundle: false });
  }

  async function scanBarcode(barcode: string) {
    if (isOffline)
      return "Connection unavailable. Reconnect to scan a barcode.";
    const result = await barcodeScan.resolve(barcode);
    if (!result.ok) return result.message;
    const item = result.item;
    const outOfStock = isOutOfStock(item);
    if (outOfStock)
      return `${item.item_name || item.item_code} is out of stock.`;
    setSearchQuery("");
    const added = await addItem(item);
    if (added) {
      setCatalogueNotice(
        `${item.item_name || item.item_code} added to the cart.`,
      );
      return null;
    }
    return `Could not add ${item.item_name || item.item_code}. Please try again.`;
  }

  async function submitSearch() {
    const submitted = searchQuery.trim();
    if (!submitted || pendingItemCode) return;
    const error = await scanBarcode(submitted);
    if (error) setAddError(error);
  }

  const renderItem: ListRenderItem<PosCatalogueItem> = ({ item }) =>
    hideImages ? (
      <PosItemListRow
        currency={currency}
        currencyPrecision={currencyPrecision}
        isAdding={pendingItemCode === item.item_code}
        isOffline={isOffline}
        item={item}
        onAdd={addItem}
      />
    ) : (
      <PosItemCard
        currency={currency}
        currencyPrecision={currencyPrecision}
        imageUrl={itemImageUrl(item.image, companyUrl)}
        isAdding={pendingItemCode === item.item_code}
        isOffline={isOffline}
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
          disabled={isOffline}
          onPress={isOffline ? undefined : bootstrap.reload}
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
        columnWrapperStyle={hideImages ? undefined : styles.row}
        contentContainerStyle={styles.listContent}
        data={visibleItems}
        keyExtractor={(item) => item.item_code}
        key={`catalogue-${hideImages ? "list" : "grid"}`}
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
              onSubmit={() => void submitSearch()}
              scanDisabled={isOffline}
              value={searchQuery}
            />
            {itemSearch.error ? (
              <View
                style={[
                  styles.catalogueError,
                  {
                    backgroundColor: palette.errorSurface,
                    borderColor: palette.errorSurface,
                  },
                ]}
              >
                <Text style={[styles.addError, { color: palette.error }]}>
                  {itemSearch.error}
                </Text>
                <Pressable
                  accessibilityLabel="Retry catalogue search"
                  disabled={isOffline}
                  onPress={isOffline ? undefined : itemSearch.reload}
                  style={[styles.retryButton, { borderColor: palette.border }]}
                >
                  <Text
                    style={[
                      styles.retryButtonLabel,
                      { color: palette.onSurface },
                    ]}
                  >
                    Try again
                  </Text>
                </Pressable>
              </View>
            ) : null}
            {addError ? (
              <Text style={[styles.addError, { color: palette.error }]}>
                {addError}
              </Text>
            ) : null}
            {catalogueNotice || workspaceNotice ? (
              <Text
                style={[styles.catalogueNotice, { color: palette.success }]}
              >
                {catalogueNotice || workspaceNotice}
              </Text>
            ) : null}
          </View>
        }
        numColumns={hideImages ? 1 : 2}
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
      <PosVariantPickerSheet
        currency={currency}
        currencyPrecision={currencyPrecision}
        error={variantActionError || templateVariants.error}
        isOffline={isOffline}
        isLoading={templateVariants.isLoading}
        isSelecting={Boolean(pendingItemCode)}
        onDismiss={() => {
          if (!pendingItemCode) setVariantTemplate(null);
        }}
        onRetry={isOffline ? () => undefined : templateVariants.reload}
        onSelect={(variant) => void selectVariant(variant)}
        templateName={variantTemplate?.item_name}
        variants={templateVariants.data?.variants ?? []}
        visible={Boolean(variantTemplate)}
      />
      <PosProductBundleSheet
        bundle={productBundle.data}
        error={productBundle.error}
        isAdding={pendingItemCode === bundleItem?.item_code}
        isOffline={isOffline}
        isLoading={productBundle.isLoading}
        itemName={bundleItem?.item_name}
        onConfirm={() => void confirmBundle()}
        onDismiss={() => !pendingItemCode && setBundleItem(null)}
        visible={Boolean(bundleItem)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  catalogueError: {
    alignItems: "center",
    borderWidth: 1,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  catalogueNotice: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  addError: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
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
