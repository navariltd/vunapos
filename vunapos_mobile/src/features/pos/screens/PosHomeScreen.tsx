import { useEffect, useState } from 'react';
import { FlatList, ListRenderItem, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosCartButton } from '@/features/pos/components/PosCartButton';
import { PosItemCard } from '@/features/pos/components/PosItemCard';
import { PosItemSearch } from '@/features/pos/components/PosItemSearch';
import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosItemSearch } from '@/features/pos/hooks/usePosItemSearch';
import { PosCatalogueItem } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

function matchesSearch(item: PosCatalogueItem, searchTerm: string) {
  const normalizedItem = `${item.item_name} ${item.item_code} ${item.barcode || ''}`.toLowerCase();
  return normalizedItem.includes(searchTerm.trim().toLowerCase());
}

type PosHomeScreenProps = {
  cartItemCount: number;
  onAddToCart: (item: PosCatalogueItem, currency: string) => void;
  onOpenCart: () => void;
  onPosProfileLoaded: (profileName: string) => void;
};

export function PosHomeScreen({ cartItemCount, onAddToCart, onOpenCart, onPosProfileLoaded }: PosHomeScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const bootstrap = usePosBootstrap();
  const itemSearch = usePosItemSearch({ posProfile: bootstrap.data?.pos_profile.name, query: searchQuery });
  const bootstrapItems = bootstrap.data?.items ?? [];
  const localMatches = bootstrapItems.filter((item) => matchesSearch(item, searchQuery));
  const items = searchQuery.trim() ? itemSearch.items : localMatches;
  const currency = bootstrap.data?.pos_profile.currency || 'KES';

  useEffect(() => {
    const profileName = bootstrap.data?.pos_profile.name;
    if (profileName) onPosProfileLoaded(profileName);
  }, [bootstrap.data?.pos_profile.name, onPosProfileLoaded]);

  function addItem(item: PosCatalogueItem) {
    const outOfStock = Boolean(item.is_stock_item) && !item.allow_negative_stock && Number(item.actual_qty || 0) <= 0;
    if (outOfStock) return;
    onAddToCart(item, currency);
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
            <PosItemSearch onChangeText={setSearchQuery} value={searchQuery} />
          </View>
        )}
        numColumns={2}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
      />
      <PosCartButton itemCount={cartItemCount} onPress={onOpenCart} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    position: 'relative',
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
});
