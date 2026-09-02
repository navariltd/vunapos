import { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosInvoiceListItem } from '@/features/pos/components/PosInvoiceListItem';
import { previewInvoices } from '@/features/pos/data/previewInvoices';
import { PosPreviewInvoice } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

function matchesSearch(invoice: PosPreviewInvoice, searchTerm: string) {
  const normalizedInvoice = `${invoice.invoiceNumber} ${invoice.customerName}`.toLowerCase();
  return normalizedInvoice.includes(searchTerm.trim().toLowerCase());
}

export function PosInvoicesScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredInvoices = useMemo(() => previewInvoices.filter((invoice) => matchesSearch(invoice, searchQuery)), [searchQuery]);

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={filteredInvoices}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(invoice) => invoice.invoiceNumber}
      ListEmptyComponent={<Text style={styles.emptyState}>No invoices match that search.</Text>}
      ListHeaderComponent={(
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>Invoices</Text>
            <Text style={styles.subtitle}>Review completed sales from this POS workspace.</Text>
          </View>
          <View style={styles.historyLabel}><Text style={styles.historyLabelText}>Sales history</Text></View>
          <TextInput
            accessibilityLabel="Search invoices"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchQuery}
            placeholder="Search invoice or customer"
            placeholderTextColor="#8f8f8f"
            style={styles.searchInput}
            value={searchQuery}
          />
        </View>
      )}
      renderItem={({ item }) => <PosInvoiceListItem invoice={item} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  emptyState: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingTop: spacing.xxl,
    textAlign: 'center',
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  heading: {
    gap: 4,
  },
  historyLabel: {
    alignSelf: 'flex-start',
    borderBottomColor: posDarkColors.primary,
    borderBottomWidth: 2,
    paddingBottom: spacing.xs,
  },
  historyLabelText: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  searchInput: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
  subtitle: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 22,
  },
});
