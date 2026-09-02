import { useMemo, useState } from 'react';
import { FlatList, ListRenderItem, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { AppShell } from '@/features/shell/components/AppShell';
import { PosCartButton } from '@/features/pos/components/PosCartButton';
import { PosItemCard } from '@/features/pos/components/PosItemCard';
import { PosItemSearch } from '@/features/pos/components/PosItemSearch';
import { previewItems } from '@/features/pos/data/previewItems';
import { PosOrderType, PosPreviewItem } from '@/features/pos/types';
import { posDarkColors, spacing, typography } from '@/theme/tokens';

function matchesSearch(item: PosPreviewItem, searchTerm: string) {
  const normalizedItem = `${item.itemName} ${item.itemCode}`.toLowerCase();
  return normalizedItem.includes(searchTerm.trim().toLowerCase());
}

export function PosHomeScreen() {
  const [cartItemCount, setCartItemCount] = useState(0);
  const [orderType, setOrderType] = useState<PosOrderType>('Invoice');
  const [searchQuery, setSearchQuery] = useState('');
  const filteredItems = useMemo(() => previewItems.filter((item) => matchesSearch(item, searchQuery)), [searchQuery]);

  function addItem(item: PosPreviewItem) {
    if (item.quantity > 0) {
      setCartItemCount((count) => count + 1);
    }
  }

  const renderItem: ListRenderItem<PosPreviewItem> = ({ item }) => <PosItemCard item={item} onAdd={addItem} />;

  return (
    <AppShell onOrderTypeChange={setOrderType} orderType={orderType}>
      <View style={styles.content}>
        <FlatList
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.listContent}
          data={filteredItems}
          keyExtractor={(item) => item.itemCode}
          ListEmptyComponent={<Text style={styles.emptyState}>No items found. Try another item name, code, or barcode.</Text>}
          ListHeaderComponent={<PosItemSearch onChangeText={setSearchQuery} value={searchQuery} />}
          numColumns={2}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
        />
        <PosCartButton itemCount={cartItemCount} />
      </View>
    </AppShell>
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
  listContent: {
    paddingBottom: 88,
  },
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
});
