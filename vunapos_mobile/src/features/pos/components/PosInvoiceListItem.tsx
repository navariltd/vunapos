import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { PosInvoiceListRow, PosInvoiceStatus } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoiceListItemProps = {
  invoice: PosInvoiceListRow;
};

const statusStyles: Record<PosInvoiceStatus, { backgroundColor: string; color: string }> = {
  'Credit Note': { backgroundColor: '#4a3010', color: '#f3c579' },
  Cancelled: { backgroundColor: '#3d1f1f', color: posDarkColors.error },
  Overdue: { backgroundColor: '#3d1f1f', color: posDarkColors.error },
  Paid: { backgroundColor: '#16452e', color: '#86efac' },
  'Partly Paid': { backgroundColor: '#4a3010', color: '#f3c579' },
  Unpaid: { backgroundColor: '#3d1f1f', color: posDarkColors.error },
};

function formatCurrency(amount: number, currency = 'KES') {
  return new Intl.NumberFormat(undefined, {
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: 'currency',
  }).format(amount);
}

function paymentReference(transactionReference?: string, paymentRequest?: string) {
  return transactionReference || paymentRequest || null;
}

export function PosInvoiceListItem({ invoice }: PosInvoiceListItemProps) {
  const statusStyle = statusStyles[invoice.status];

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <Text numberOfLines={1} style={styles.invoiceNumber}>{invoice.invoiceNumber}</Text>
          <Text numberOfLines={1} style={styles.customer}>{invoice.customerName}</Text>
          {invoice.customerId ? <Text numberOfLines={1} style={styles.customerId}>{invoice.customerId}</Text> : null}
        </View>
        <View style={[styles.status, statusStyle]}>
          <Text style={[styles.statusLabel, { color: statusStyle.color }]}>{invoice.status}</Text>
        </View>
      </View>

      <View style={styles.metadataRow}>
        <Text style={styles.metadata}>{invoice.postedAt}</Text>
        <Text style={styles.metadata}>{invoice.itemCount} {invoice.itemCount === 1 ? 'item' : 'items'}</Text>
      </View>

      <View style={styles.auditRow}>
        <Text numberOfLines={1} style={styles.auditValue}>Cashier: {invoice.cashier || 'Not recorded'}</Text>
        <Text numberOfLines={1} style={styles.auditValue}>Shift: {invoice.openingEntry || 'No shift'}</Text>
      </View>

      <View style={styles.paymentLines}>
        {invoice.payments.length ? invoice.payments.map((payment, index) => {
          const reference = paymentReference(payment.transaction_reference, payment.ke_payment_request);
          return (
            <View key={`${payment.mode_of_payment}-${reference || index}`} style={styles.paymentLine}>
              <Text numberOfLines={1} style={styles.paymentMode}>{payment.mode_of_payment}{reference ? ` · ${reference}` : ''}</Text>
              <Text style={styles.paymentAmount}>{formatCurrency(payment.amount, invoice.currency)}</Text>
            </View>
          );
        }) : <Text style={styles.paymentMode}>{invoice.paymentMode}</Text>}
      </View>

      <View style={styles.totalRow}>
        <View>
          <Text style={styles.totalLabel}>Total</Text>
          {invoice.outstandingAmount > 0 ? <Text style={styles.outstanding}>Outstanding {formatCurrency(invoice.outstandingAmount, invoice.currency)}</Text> : null}
        </View>
        <Text style={styles.total}>{formatCurrency(invoice.total, invoice.currency)}</Text>
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
  auditRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  auditValue: {
    color: posDarkColors.onSurfaceMuted,
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  customer: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  customerId: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
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
  paymentAmount: {
    color: posDarkColors.onSurface,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  paymentLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  paymentLines: {
    gap: 4,
  },
  outstanding: {
    color: '#f3c579',
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    marginTop: 2,
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
  totalLabel: {
    color: posDarkColors.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
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
