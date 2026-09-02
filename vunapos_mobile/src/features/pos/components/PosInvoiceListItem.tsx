import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosInvoiceStatus, PosPreviewInvoice } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoiceListItemProps = {
  invoice: PosPreviewInvoice;
};

const statusStyles: Record<PosInvoiceStatus, { backgroundColor: string; color: string }> = {
  'Credit Note': { backgroundColor: '#4a3010', color: '#f3c579' },
  Paid: { backgroundColor: '#16452e', color: '#86efac' },
  'Partly Paid': { backgroundColor: '#4a3010', color: '#f3c579' },
  Unpaid: { backgroundColor: '#3d1f1f', color: posDarkColors.error },
};

function formatCurrency(amount: number) {
  return `KES ${amount.toFixed(2)}`;
}

export function PosInvoiceListItem({ invoice }: PosInvoiceListItemProps) {
  const statusStyle = statusStyles[invoice.status];

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text numberOfLines={1} style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
          <Text numberOfLines={1} style={styles.customer}>{invoice.customerName}</Text>
        </View>
        <View style={[styles.status, statusStyle]}>
          <Text style={[styles.statusLabel, { color: statusStyle.color }]}>{invoice.status}</Text>
        </View>
      </View>

      <View style={styles.metadataRow}>
        <Text style={styles.metadata}>{invoice.postedAt}</Text>
        <Text style={styles.metadata}>{invoice.itemCount} {invoice.itemCount === 1 ? 'item' : 'items'}</Text>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.paymentMode}>{invoice.paymentMode}</Text>
        <Text style={styles.total}>{formatCurrency(invoice.total)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: posDarkColors.surface,
    borderColor: posDarkColors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  customer: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  invoiceNumber: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  metadata: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  metadataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentMode: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  status: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  titleGroup: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  total: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 15,
  },
  totalRow: {
    alignItems: 'center',
    borderTopColor: posDarkColors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
});
