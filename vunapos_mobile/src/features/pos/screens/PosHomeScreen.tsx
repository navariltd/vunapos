import { useMemo, useState } from 'react';
import { FlatList, ListRenderItem, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosCartButton } from '@/features/pos/components/PosCartButton';
import { PosItemCard } from '@/features/pos/components/PosItemCard';
import { PosItemSearch } from '@/features/pos/components/PosItemSearch';
import { previewItems } from '@/features/pos/data/previewItems';
import { PosPreviewItem, PosSaleCustomer } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

function matchesSearch(item: PosPreviewItem, searchTerm: string) {
  const normalizedItem = `${item.itemName} ${item.itemCode}`.toLowerCase();
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
  const filteredItems = useMemo(() => previewItems.filter((item) => matchesSearch(item, searchQuery)), [searchQuery]);

  function addItem(item: PosPreviewItem) {
    if (item.quantity > 0) {
      onAddToCart();
    }
  }

  const renderItem: ListRenderItem<PosPreviewItem> = ({ item }) => <PosItemCard item={item} onAdd={addItem} />;

  return (
    <View style={styles.content}>
      <FlatList
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.listContent}
        data={filteredItems}
        keyExtractor={(item) => item.itemCode}
        ListEmptyComponent={<Text style={styles.emptyState}>No items found. Try another item name, code, or barcode.</Text>}
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
  listContent: {
    paddingBottom: 88,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
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
