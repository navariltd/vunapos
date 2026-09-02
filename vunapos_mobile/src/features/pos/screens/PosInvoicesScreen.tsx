import { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosInvoiceListItem } from '@/features/pos/components/PosInvoiceListItem';
import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosInvoiceHistory } from '@/features/pos/hooks/usePosInvoiceHistory';
import { PosInvoiceHistoryFilters, PosInvoiceHistoryRow, PosInvoiceListRow } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

const initialFilters: PosInvoiceHistoryFilters = {
  currentShift: true,
  customer: '',
  documentType: 'Invoice',
  fromDate: '',
  invoice: '',
  paymentMode: '',
  saleType: '',
  status: '',
  toDate: '',
};

const statusOptions: { label: string; value: PosInvoiceHistoryFilters['status'] }[] = [
  { label: 'All statuses', value: '' },
  { label: 'Paid', value: 'Paid' },
  { label: 'Partly paid', value: 'Partly Paid' },
  { label: 'Unpaid', value: 'Unpaid' },
  { label: 'Overdue', value: 'Overdue' },
  { label: 'Cancelled', value: 'Cancelled' },
  { label: 'Credit note', value: 'Credit Note' },
];

function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
}

function formatPostedAt(row: PosInvoiceHistoryRow) {
  const date = row.posting_date ? row.posting_date.split('-').reverse().join('/') : '-';
  const time = row.posting_time?.split('.')[0]?.slice(0, 5);
  return time ? `${date} · ${time}` : date;
}

function toListRow(row: PosInvoiceHistoryRow): PosInvoiceListRow {
  return {
    customerName: row.customer_name || row.customer || 'No customer',
    invoiceNumber: row.name,
    itemCount: row.total_qty,
    paymentMode: row.payments.length
      ? row.payments.map((payment) => payment.mode_of_payment).join(' · ')
      : row.vunapos_credit_sale ? 'No deposit' : 'No payment rows',
    postedAt: formatPostedAt(row),
    status: row.status,
    total: row.rounded_total || row.grand_total,
  };
}

type FilterChoiceProps<T extends string> = {
  active: boolean;
  label: string;
  onPress: () => void;
  value: T;
};

function FilterChoice<T extends string>({ active, label, onPress }: FilterChoiceProps<T>) {
  return (
    <Pressable onPress={onPress} style={[styles.filterChoice, active && styles.filterChoiceActive]}>
      <Text style={[styles.filterChoiceLabel, active && styles.filterChoiceLabelActive]}>{label}</Text>
    </Pressable>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

export function PosInvoicesScreen() {
  const [filters, setFilters] = useState<PosInvoiceHistoryFilters>(initialFilters);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [start, setStart] = useState(0);
  const bootstrap = usePosBootstrap();
  const history = usePosInvoiceHistory({ filters, posProfile: bootstrap.data?.pos_profile.name, start });
  const currency = bootstrap.data?.pos_profile.currency ?? 'KES';
  const invoiceRows = useMemo(() => history.data?.invoices.map(toListRow) ?? [], [history.data]);

  function updateFilter<Key extends keyof PosInvoiceHistoryFilters>(field: Key, value: PosInvoiceHistoryFilters[Key]) {
    setFilters((current) => ({ ...current, [field]: value }));
    setStart(0);
  }

  function clearFilters() {
    setFilters(initialFilters);
    setStart(0);
  }

  const historyError = bootstrap.error ?? history.error;

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={invoiceRows}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      keyExtractor={(invoice) => invoice.invoiceNumber}
      ListEmptyComponent={(
        bootstrap.isLoading || history.isLoading
          ? <Text style={styles.emptyState}>{bootstrap.isLoading ? 'Loading POS workspace…' : 'Loading invoice history…'}</Text>
          : historyError ? null
          : <Text style={styles.emptyState}>No {filters.documentType === 'Order' ? 'orders' : 'invoices'} match these filters.</Text>
      )}
      ListFooterComponent={history.data ? (
        <View style={styles.pagination}>
          <Pressable disabled={start === 0} onPress={() => setStart((current) => Math.max(0, current - 25))} style={[styles.paginationButton, start === 0 && styles.paginationButtonDisabled]}>
            <Text style={styles.paginationLabel}>Previous</Text>
          </Pressable>
          <Pressable disabled={!history.data.has_more} onPress={() => setStart((current) => current + 25)} style={[styles.paginationButton, !history.data.has_more && styles.paginationButtonDisabled]}>
            <Text style={styles.paginationLabel}>Next</Text>
          </Pressable>
        </View>
      ) : null}
      ListHeaderComponent={(
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={styles.title}>Invoices</Text>
            <Text style={styles.subtitle}>Review completed sales from this POS workspace.</Text>
          </View>

          <View style={styles.documentTabs}>
            <FilterChoice active={filters.documentType === 'Invoice'} label="Sales history" onPress={() => updateFilter('documentType', 'Invoice')} value="Invoice" />
            <FilterChoice active={filters.documentType === 'Order'} label="Sales orders" onPress={() => updateFilter('documentType', 'Order')} value="Order" />
          </View>

          <View style={styles.searchRow}>
            <TextInput
              accessibilityLabel="Filter by invoice number"
              autoCapitalize="characters"
              onChangeText={(value) => updateFilter('invoice', value)}
              placeholder="Invoice number"
              placeholderTextColor="#8f8f8f"
              style={styles.searchInput}
              value={filters.invoice}
            />
            <Pressable onPress={() => setFiltersVisible((visible) => !visible)} style={[styles.filtersButton, filtersVisible && styles.filtersButtonActive]}>
              <Text style={[styles.filtersButtonLabel, filtersVisible && styles.filtersButtonLabelActive]}>{filtersVisible ? 'Hide filters' : 'Filters'}</Text>
            </Pressable>
          </View>

          {filtersVisible ? (
            <View style={styles.filtersPanel}>
              <TextInput
                accessibilityLabel="Filter by customer ID"
                autoCapitalize="none"
                onChangeText={(value) => updateFilter('customer', value)}
                placeholder="Customer ID"
                placeholderTextColor="#8f8f8f"
                style={styles.filterInput}
                value={filters.customer}
              />
              <View style={styles.dateRow}>
                <TextInput
                  accessibilityLabel="Filter from date"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={(value) => updateFilter('fromDate', value)}
                  placeholder="From date (YYYY-MM-DD)"
                  placeholderTextColor="#8f8f8f"
                  style={[styles.filterInput, styles.halfWidth]}
                  value={filters.fromDate}
                />
                <TextInput
                  accessibilityLabel="Filter to date"
                  keyboardType="numbers-and-punctuation"
                  onChangeText={(value) => updateFilter('toDate', value)}
                  placeholder="To date (YYYY-MM-DD)"
                  placeholderTextColor="#8f8f8f"
                  style={[styles.filterInput, styles.halfWidth]}
                  value={filters.toDate}
                />
              </View>
              <Text style={styles.filterLabel}>Status</Text>
              <ScrollView contentContainerStyle={styles.filterChoices} horizontal showsHorizontalScrollIndicator={false}>
                {statusOptions.map((option) => <FilterChoice active={filters.status === option.value} key={option.label} label={option.label} onPress={() => updateFilter('status', option.value)} value={option.value} />)}
              </ScrollView>
              <Text style={styles.filterLabel}>Payment mode</Text>
              <ScrollView contentContainerStyle={styles.filterChoices} horizontal showsHorizontalScrollIndicator={false}>
                <FilterChoice active={filters.paymentMode === ''} label="All payments" onPress={() => updateFilter('paymentMode', '')} value="" />
                {bootstrap.data?.payment_modes.map((payment) => <FilterChoice active={filters.paymentMode === payment.mode_of_payment} key={payment.mode_of_payment} label={payment.mode_of_payment} onPress={() => updateFilter('paymentMode', payment.mode_of_payment)} value={payment.mode_of_payment} />)}
              </ScrollView>
              <Text style={styles.filterLabel}>Sale type</Text>
              <View style={styles.filterChoices}>
                <FilterChoice active={filters.saleType === ''} label="All sales" onPress={() => updateFilter('saleType', '')} value="" />
                <FilterChoice active={filters.saleType === 'Cash Sale'} label="Cash sale" onPress={() => updateFilter('saleType', 'Cash Sale')} value="Cash Sale" />
                <FilterChoice active={filters.saleType === 'Credit Sale'} label="Credit sale" onPress={() => updateFilter('saleType', 'Credit Sale')} value="Credit Sale" />
              </View>
              <View style={styles.currentShiftRow}>
                <View style={styles.currentShiftCopy}>
                  <Text style={styles.filterLabel}>Current shift only</Text>
                  <Text style={styles.filterHint}>Show sales posted in your active POS shift.</Text>
                </View>
                <Switch
                  accessibilityLabel="Current shift only"
                  onValueChange={(value) => updateFilter('currentShift', value)}
                  thumbColor={filters.currentShift ? posDarkColors.primary : posDarkColors.onSurfaceMuted}
                  trackColor={{ false: posDarkColors.surfaceContainerHigh, true: '#5f5f5f' }}
                  value={filters.currentShift}
                />
              </View>
              <Pressable onPress={clearFilters} style={styles.clearFiltersButton}><Text style={styles.clearFiltersLabel}>Clear filters</Text></Pressable>
            </View>
          ) : null}

          {historyError ? <View style={styles.errorNotice}><Text style={styles.errorText}>{historyError}</Text></View> : null}
          {history.isLoading && history.data ? <Text style={styles.refreshingText}>Refreshing invoice history…</Text> : null}

          {history.data ? (
            <View style={styles.summaryGrid}>
              <SummaryCard label={filters.documentType === 'Order' ? 'Orders' : 'Invoices'} value={String(history.data.summary.invoice_count)} />
              <SummaryCard label="Gross sales" value={formatCurrency(history.data.summary.gross_sales, currency)} />
              <SummaryCard label="Returns" value={formatCurrency(history.data.summary.returns, currency)} />
              <SummaryCard label="Outstanding" value={formatCurrency(history.data.summary.outstanding, currency)} />
              <SummaryCard label="Credit sales" value={formatCurrency(history.data.summary.credit_sales, currency)} />
              <SummaryCard label="Credit outstanding" value={formatCurrency(history.data.summary.credit_outstanding, currency)} />
            </View>
          ) : null}
        </View>
      )}
      renderItem={({ item }) => <PosInvoiceListItem invoice={item} />}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  clearFiltersButton: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
  },
  clearFiltersLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  currentShiftCopy: {
    flex: 1,
    gap: 2,
  },
  currentShiftRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  documentTabs: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  emptyState: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingTop: spacing.xxl,
    textAlign: 'center',
  },
  errorNotice: {
    backgroundColor: '#3d1f1f',
    borderColor: posDarkColors.error,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  errorText: {
    color: posDarkColors.error,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  filterChoice: {
    borderColor: posDarkColors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  filterChoiceActive: {
    backgroundColor: posDarkColors.primary,
    borderColor: posDarkColors.primary,
  },
  filterChoiceLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  filterChoiceLabelActive: {
    color: posDarkColors.onPrimary,
  },
  filterChoices: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  filterHint: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  filterInput: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  filterLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  filtersButton: {
    alignItems: 'center',
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  filtersButtonActive: {
    backgroundColor: posDarkColors.primary,
    borderColor: posDarkColors.primary,
  },
  filtersButtonLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  filtersButtonLabelActive: {
    color: posDarkColors.onPrimary,
  },
  filtersPanel: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  halfWidth: {
    minWidth: 0,
  },
  header: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  heading: {
    gap: 4,
  },
  pagination: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    paddingTop: spacing.lg,
  },
  paginationButton: {
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  paginationButtonDisabled: {
    opacity: 0.4,
  },
  paginationLabel: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  refreshingText: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  searchInput: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: posDarkColors.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    height: 44,
    paddingHorizontal: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
  summaryCard: {
    backgroundColor: posDarkColors.surfaceContainer,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: '48%',
    flexGrow: 1,
    gap: 2,
    padding: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  summaryValue: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  title: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 22,
  },
});
