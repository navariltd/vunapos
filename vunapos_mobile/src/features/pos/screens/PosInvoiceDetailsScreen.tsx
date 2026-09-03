import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { usePosBootstrap } from '@/features/pos/hooks/usePosBootstrap';
import { usePosInvoiceDetails } from '@/features/pos/hooks/usePosInvoiceDetails';
import { PosInvoiceDetail, PosInvoiceStatus } from '@/features/pos/types';
import { posDarkColors, radii, spacing, typography } from '@/theme/tokens';

type PosInvoiceDetailsScreenProps = {
  invoiceDoctype?: string;
  invoiceName: string;
  onBack: () => void;
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
  return new Intl.NumberFormat(undefined, { currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2, style: 'currency' }).format(amount);
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function formatDateTime(details: PosInvoiceDetail) {
  const date = formatDate(details.posting_date);
  const time = details.posting_time?.split('.')[0]?.slice(0, 5);
  return time ? `${date} · ${time}` : date;
}

function DetailCard({ children, title }: { children: React.ReactNode; title: string }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  return <View style={styles.summaryValue}><Text style={styles.summaryLabel}>{label}</Text><Text numberOfLines={1} style={styles.summaryText}>{value}</Text></View>;
}

function KeyValue({ label, value }: { label: string; value?: string }) {
  return <View style={styles.keyValue}><Text style={styles.keyLabel}>{label}</Text><Text numberOfLines={1} style={styles.keyText}>{value || '-'}</Text></View>;
}

export function PosInvoiceDetailsScreen({ invoiceDoctype, invoiceName, onBack }: PosInvoiceDetailsScreenProps) {
  const bootstrap = usePosBootstrap();
  const details = usePosInvoiceDetails({ invoiceDoctype, invoiceName, posProfile: bootstrap.data?.pos_profile.name });
  const error = bootstrap.error ?? details.error;

  if (bootstrap.isLoading || details.isLoading) {
    return <View style={styles.state}><Text style={styles.stateText}>Loading invoice…</Text></View>;
  }

  if (!details.data || error) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{error || 'Invoice not found.'}</Text>
        <Pressable onPress={onBack} style={styles.backButton}><Text style={styles.backButtonLabel}>Back to invoices</Text></Pressable>
      </View>
    );
  }

  const invoice = details.data;
  const currency = invoice.currency ?? bootstrap.data?.pos_profile.currency ?? 'KES';
  const total = invoice.totals.rounded_total || invoice.totals.grand_total || 0;
  const statusStyle = statusStyles[invoice.status];
  const itemCount = invoice.items.reduce((sum, item) => sum + Number(item.qty || 0), 0);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Back to invoices" onPress={onBack} style={styles.backIconButton}>
          <MaterialCommunityIcons color={posDarkColors.onSurface} name="arrow-left" size={22} />
        </Pressable>
        <View style={styles.heading}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>{invoice.name}</Text>
            <View style={[styles.status, statusStyle]}><Text style={[styles.statusLabel, { color: statusStyle.color }]}>{invoice.status}</Text></View>
          </View>
          <Text style={styles.subtitle}>{formatDateTime(invoice)}{invoice.is_credit_sale && invoice.due_date ? ` · Due ${formatDate(invoice.due_date)}` : ''}</Text>
          {invoice.is_credit_sale ? <Text style={styles.creditSale}>Credit sale</Text> : null}
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryValue label="Grand total" value={formatCurrency(total, currency)} />
        <SummaryValue label="Paid" value={formatCurrency(invoice.totals.paid_amount || 0, currency)} />
        <SummaryValue label="Outstanding" value={formatCurrency(invoice.totals.outstanding_amount || 0, currency)} />
        <SummaryValue label="Items" value={String(itemCount)} />
      </View>

      <DetailCard title="Customer">
        <Text style={styles.customerName}>{invoice.customer_name || invoice.customer || 'No customer'}</Text>
        <Text style={styles.customerId}>{invoice.customer || '-'}</Text>
        {invoice.is_credit_sale ? <View style={styles.keyValues}><KeyValue label="Payment due" value={formatDate(invoice.due_date)} /><KeyValue label="Outstanding" value={formatCurrency(invoice.totals.outstanding_amount || 0, currency)} /></View> : null}
      </DetailCard>

      <DetailCard title="POS audit">
        <View style={styles.keyValues}>
          <KeyValue label="Cashier" value={invoice.cashier} />
          <KeyValue label="POS Profile" value={invoice.pos_profile} />
          <KeyValue label="Opening entry" value={invoice.opening_entry} />
          <KeyValue label="Closing entry" value={invoice.closing_entry} />
          <KeyValue label="Warehouse" value={invoice.warehouse} />
        </View>
      </DetailCard>

      <DetailCard title="Items">
        <View style={styles.itemList}>
          {invoice.items.map((item) => (
            <View key={item.row_name} style={styles.itemRow}>
              <View style={styles.itemMain}><Text style={styles.itemName}>{item.item_name}</Text><Text style={styles.itemCode}>{item.item_code}</Text><Text style={styles.itemMeta}>{item.qty} {item.uom || ''} · {formatCurrency(item.rate, currency)}</Text></View>
              <Text style={styles.itemAmount}>{formatCurrency(item.amount, currency)}</Text>
            </View>
          ))}
        </View>
      </DetailCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  backButton: { borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  backButtonLabel: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  backIconButton: { alignItems: 'center', borderColor: posDarkColors.border, borderRadius: radii.pill, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  card: { backgroundColor: posDarkColors.surface, borderColor: posDarkColors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardTitle: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  creditSale: { color: '#f3c579', fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  customerId: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  customerName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  errorText: { color: posDarkColors.error, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body, textAlign: 'center' },
  header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
  heading: { flex: 1, gap: 4 },
  itemAmount: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  itemCode: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  itemList: { gap: spacing.sm },
  itemMain: { flex: 1, gap: 2 },
  itemMeta: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  itemName: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small },
  itemRow: { alignItems: 'flex-start', borderTopColor: posDarkColors.border, borderTopWidth: 1, flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.sm },
  keyLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.tiny },
  keyText: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.medium, fontSize: typography.size.small, textAlign: 'right' },
  keyValue: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  keyValues: { gap: spacing.xs },
  state: { alignItems: 'center', flex: 1, gap: spacing.md, justifyContent: 'center', padding: spacing.lg },
  stateText: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.body },
  status: { borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  statusLabel: { fontFamily: typography.fontFamily.semibold, fontSize: typography.size.tiny },
  subtitle: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryLabel: { color: posDarkColors.onSurfaceMuted, fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  summaryText: { color: posDarkColors.onSurface, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.small },
  summaryValue: { backgroundColor: posDarkColors.surfaceContainer, borderRadius: radii.md, flexBasis: '47%', flexGrow: 1, gap: 4, padding: spacing.sm },
  title: { color: posDarkColors.onSurface, flex: 1, fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm },
});
