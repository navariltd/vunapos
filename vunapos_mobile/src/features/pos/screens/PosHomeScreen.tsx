import { useState } from 'react';
import { FlatList, ListRenderItem, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosCartButton } from '@/features/pos/components/PosCartButton';
import { PosItemCard } from '@/features/pos/components/PosItemCard';
import { PosItemSearch } from '@/features/pos/components/PosItemSearch';
import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosItemSearch } from '@/features/pos/hooks/usePosItemSearch';
import { PosCatalogueItem, PosSaleCustomer } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

function matchesSearch(item: PosCatalogueItem, searchTerm: string) {
  const normalizedItem = `${item.item_name} ${item.item_code} ${item.barcode || ''}`.toLowerCase();
  return normalizedItem.includes(searchTerm.trim().toLowerCase());
}

type PosHomeScreenProps = {
  cartItemCount: number;
  onAddToCart: () => void;
  onClearSaleCustomer: () => void;
  saleCustomer: PosSaleCustomer | null;
};

export function PosHomeScreen({ cartItemCount, onAddToCart, onClearSaleCustomer, saleCustomer }: PosHomeScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const bootstrap = usePosBootstrap();
  const itemSearch = usePosItemSearch({ posProfile: bootstrap.data?.pos_profile.name, query: searchQuery });
  const bootstrapItems = bootstrap.data?.items ?? [];
  const localMatches = bootstrapItems.filter((item) => matchesSearch(item, searchQuery));
  const items = searchQuery.trim() ? itemSearch.items : localMatches;
  const currency = bootstrap.data?.pos_profile.currency || 'KES';

  function addItem(item: PosCatalogueItem) {
    const outOfStock = Boolean(item.is_stock_item) && !item.allow_negative_stock && Number(item.actual_qty || 0) <= 0;
    if (!outOfStock) {
      onAddToCart();
    }
  }

  const renderItem: ListRenderItem<PosCatalogueItem> = ({ item }) => <PosItemCard currency={currency} item={item} onAdd={addItem} />;

  if (bootstrap.isLoading) return <View style={styles.state}><Text style={styles.stateText}>Loading your POS catalogue…</Text></View>;
  if (bootstrap.error || !bootstrap.data) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{bootstrap.error || 'Could not load the POS catalogue.'}</Text>
        <Pressable accessibilityLabel="Retry loading POS catalogue" onPress={bootstrap.reload} style={styles.retryButton}><Text style={styles.retryButtonLabel}>Try again</Text></Pressable>
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
        ListEmptyComponent={<Text style={styles.emptyState}>{itemSearch.isLoading ? 'Searching the catalogue…' : itemSearch.error || 'No items found. Try another item name, code, or barcode.'}</Text>}
        ListHeaderComponent={(
          <View>
            {saleCustomer ? (
              <View style={styles.saleCustomer}>
                <View style={styles.saleCustomerDetails}>
                  <Text style={styles.saleCustomerLabel}>Customer</Text>
                  <Text numberOfLines={1} style={styles.saleCustomerName}>{saleCustomer.customerName}</Text>
                  <Text style={styles.saleCustomerId}>{saleCustomer.customer}</Text>
                </View>
                <Pressable accessibilityLabel="Clear sale customer" onPress={onClearSaleCustomer} style={styles.clearCustomerButton}>
                  <Text style={styles.clearCustomerButtonLabel}>Clear</Text>
                </Pressable>
              </View>
            ) : null}
            <PosItemSearch onChangeText={setSearchQuery} value={searchQuery} />
          </View>
        )}
        numColumns={2}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
      <PosCartButton itemCount={cartItemCount} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: 'relative',
  },
  clearCustomerButton: {
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  clearCustomerButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  emptyState: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xxl,
    textAlign: 'center',
  },
  errorText: {
    color: posDarkColors.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: 'center',
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
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  saleCustomer: {
    alignItems: 'center',
    backgroundColor: posDarkColors.surfaceContainer,
    borderBottomColor: posDarkColors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  state: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  stateText: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: 'center',
  },
  saleCustomerDetails: {
    flex: 1,
    gap: 2,
  },
  saleCustomerId: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  saleCustomerLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  saleCustomerName: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
});
