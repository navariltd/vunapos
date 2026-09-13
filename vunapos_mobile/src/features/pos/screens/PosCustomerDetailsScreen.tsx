import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosCustomerDetails } from "@/features/pos/hooks/usePosCustomerDetails";
import { formatPosCurrency } from "@/features/pos/currency";
import {
  PosCustomerAddress,
  PosCustomerInvoice,
  PosCustomerPayment,
  PosSaleCustomer,
} from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCustomerDetailsScreenProps = {
  customer: string;
  onBack: () => void;
  onOpenInvoice?: (invoice: PosCustomerInvoice) => void;
  onOpenPaymentEntry?: (payment: PosCustomerPayment) => void;
  onReceivePayment?: (customer: PosSaleCustomer) => void;
  onStartSale: (customer: PosSaleCustomer) => void;
};

function formatAddress(address?: PosCustomerAddress | null) {
  if (!address) return null;

  return (
    [
      address.address_line1,
      address.address_line2,
      address.city,
      address.state,
      address.country,
      address.pincode,
    ]
      .filter(Boolean)
      .join(", ") || null
  );
}

function formatDateTime(value: string) {
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-");
  const formattedDate = year && month && day ? `${day}/${month}/${year}` : date;
  const formattedTime = time?.split(".")[0];
  return formattedTime ? `${formattedDate} ${formattedTime}` : formattedDate;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const [year, month, day] = value.split(" ")[0].split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function DetailCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const { palette } = useAppearance();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.cardTitle, { color: palette.onSurface }]}>{title}</Text>
      {children}
    </View>
  );
}

function SummaryValue({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  const { palette } = useAppearance();

  return (
    <View
      style={[styles.summaryValue, { backgroundColor: palette.surfaceContainer }]}
    >
      <Text style={[styles.summaryLabel, { color: palette.onSurfaceMuted }]}>
        {label}
      </Text>
      <Text
        numberOfLines={1}
        style={[styles.summaryText, { color: palette.onSurface }]}
      >
        {value}
      </Text>
      {sub ? (
        <Text
          numberOfLines={1}
          style={[styles.summarySubtext, { color: palette.onSurfaceMuted }]}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function CustomerInvoiceRow({
  currency,
  currencyPrecision,
  invoice,
  onPress,
}: {
  currency: string;
  currencyPrecision: number;
  invoice: PosCustomerInvoice;
  onPress?: () => void;
}) {
  const { palette } = useAppearance();
  const status = invoice.status || "Unknown";
  const statusColor =
    status === "Paid"
      ? palette.success
      : status === "Partly Paid"
        ? palette.primary
        : status === "Unpaid" || status === "Overdue"
          ? palette.error
          : palette.onSurface;
  const formatCurrency = (amount: number, amountCurrency = currency) =>
    formatPosCurrency(amount, amountCurrency, currencyPrecision);

  return (
    <Pressable
      accessibilityLabel={`Open customer invoice ${invoice.name}`}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.invoiceRow,
        {
          backgroundColor: palette.surfaceContainer,
          borderColor: palette.borderSubtle,
        },
      ]}
    >
      <View style={styles.invoiceRowHeader}>
        <View style={styles.invoiceIdentity}>
          <Text style={[styles.invoiceName, { color: palette.onSurface }]}>
            {invoice.name}
          </Text>
          <Text style={[styles.invoiceDate, { color: palette.onSurfaceMuted }]}>
            {formatDate(invoice.posting_date)}
          </Text>
        </View>
        <Text style={[styles.invoiceStatus, { color: statusColor }]}>{status}</Text>
      </View>
      <View style={styles.invoiceAmounts}>
        <InvoiceAmount
          label="Total"
          value={formatCurrency(invoice.grand_total, invoice.currency || currency)}
        />
        <InvoiceAmount
          label="Paid"
          value={formatCurrency(invoice.paid_amount || 0, invoice.currency || currency)}
        />
        <InvoiceAmount
          label="Outstanding"
          value={formatCurrency(
            invoice.outstanding_amount,
            invoice.currency || currency,
          )}
        />
      </View>
    </Pressable>
  );
}

function InvoiceAmount({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  return (
    <View style={styles.invoiceAmount}>
      <Text style={[styles.invoiceAmountLabel, { color: palette.onSurfaceMuted }]}>
        {label}
      </Text>
      <Text style={[styles.invoiceAmountValue, { color: palette.onSurface }]}>
        {value}
      </Text>
    </View>
  );
}

function CustomerPaymentRow({
  currency,
  currencyPrecision,
  onPress,
  payment,
}: {
  currency: string;
  currencyPrecision: number;
  onPress?: () => void;
  payment: PosCustomerPayment;
}) {
  const { palette } = useAppearance();
  const formatCurrency = (amount: number) =>
    formatPosCurrency(amount, currency, currencyPrecision);

  return (
    <Pressable
      accessibilityLabel={`Open customer payment ${payment.name}`}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.invoiceRow,
        {
          backgroundColor: palette.surfaceContainer,
          borderColor: palette.borderSubtle,
        },
      ]}
    >
      <View style={styles.invoiceRowHeader}>
        <View style={styles.invoiceIdentity}>
          <Text style={[styles.invoiceName, { color: palette.onSurface }]}>
            {payment.name}
          </Text>
          <Text style={[styles.invoiceDate, { color: palette.onSurfaceMuted }]}>
            {formatDate(payment.posting_date)}
          </Text>
        </View>
        <Text style={[styles.paymentMode, { color: palette.onSurfaceMuted }]}>
          {payment.mode_of_payment || "Unspecified"}
        </Text>
      </View>
      <View style={styles.invoiceAmounts}>
        <InvoiceAmount
          label="Received"
          value={formatCurrency(payment.received_amount)}
        />
        <InvoiceAmount
          label="Unallocated"
          value={formatCurrency(payment.unallocated_amount)}
        />
      </View>
    </Pressable>
  );
}

export function PosCustomerDetailsScreen({
  customer,
  onBack,
  onOpenInvoice,
  onOpenPaymentEntry,
  onReceivePayment,
  onStartSale,
}: PosCustomerDetailsScreenProps) {
  const { connectionStatus } = useNetworkStatus();
  const { palette } = useAppearance();
  const isOffline = connectionStatus === "offline";
  const bootstrap = usePosBootstrap();
  const details = usePosCustomerDetails({
    customer,
    posProfile: bootstrap.data?.pos_profile.name,
  });
  const error = bootstrap.error ?? details.error;

  if (bootstrap.isLoading || details.isLoading) {
    return (
      <View style={[styles.state, { backgroundColor: palette.background }]}>
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading customer details…
        </Text>
      </View>
    );
  }

  if (!details.data || error) {
    const message = error
      ? error
      : isOffline
        ? "Reconnect to the server to load this customer."
        : "Customer not found.";
    return (
      <View style={[styles.state, { backgroundColor: palette.background }]}>
        <Text style={[styles.errorText, { color: palette.error }]}>{message}</Text>
        <Pressable
          accessibilityLabel="Retry customer details"
          accessibilityRole="button"
          disabled={isOffline}
          onPress={() => {
            bootstrap.reload();
            details.reload();
          }}
          style={[
            styles.backButton,
            { borderColor: palette.border },
            isOffline && styles.actionDisabled,
          ]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Retry
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Back to customers"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.backButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Back to customers
          </Text>
        </Pressable>
      </View>
    );
  }

  const { customer: profile } = details.data;
  const currency =
    profile.currency ?? bootstrap.data?.pos_profile.currency ?? "KES";
  const currencyPrecision = bootstrap.data?.pos_profile.currency_precision ?? 2;
  const phone =
    profile.mobile_no ||
    details.data.contact?.mobile_no ||
    details.data.contact?.phone;
  const email = profile.email_id || details.data.contact?.email_id;
  const address = formatAddress(details.data.address);
  const saleCustomer = {
    customer: profile.customer,
    customerName: profile.customer_name,
    isWalkin: profile.is_walkin,
    mobile: phone,
    taxId: profile.tax_id,
  };
  const canReceivePayment =
    Boolean(onReceivePayment) &&
    bootstrap.data?.pos_profile.allow_customer_payments !== false;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to customers"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.backIconButton, { borderColor: palette.border }]}
        >
          <MaterialCommunityIcons
            color={palette.onSurface}
            name="arrow-left"
            size={22}
          />
        </Pressable>
        <View style={styles.heading}>
          <Text
            numberOfLines={1}
            style={[styles.title, { color: palette.onSurface }]}
          >
            {profile.customer_name}
          </Text>
          <Text style={[styles.subtitle, { color: palette.onSurfaceMuted }]}>
            {profile.customer} · {profile.customer_group || "Uncategorized"}
          </Text>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryValue
          label="Current balance"
          value={formatPosCurrency(
            details.data.balance,
            currency,
            currencyPrecision,
          )}
        />
        <SummaryValue
          label="Loyalty points"
          sub={details.data.loyalty?.tier || details.data.loyalty?.program}
          value={
            details.data.loyalty
              ? details.data.loyalty.points.toLocaleString()
              : "Not enrolled"
          }
        />
        <SummaryValue
          label="Customer type"
          sub={profile.territory}
          value={profile.customer_type || "-"}
        />
        <SummaryValue
          label="Last updated"
          value={formatDateTime(details.data.as_of)}
        />
      </View>

      <DetailCard title="Contact information">
        <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
          {phone || "No phone number"}
        </Text>
        <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
          {email || "No email address"}
        </Text>
        {profile.tax_id ? (
          <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
            Tax ID: {profile.tax_id}
          </Text>
        ) : null}
      </DetailCard>

      <DetailCard title="Primary address">
        <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
          {address || "No permitted primary address available."}
        </Text>
      </DetailCard>

      <DetailCard title="Recent invoices">
        {details.data.invoices?.length ? (
          <View style={styles.invoiceList}>
            {details.data.invoices.map((invoice) => (
              <CustomerInvoiceRow
                currency={currency}
                currencyPrecision={currencyPrecision}
                invoice={invoice}
                key={`${invoice.doctype || "Sales Invoice"}:${invoice.name}`}
                onPress={
                  onOpenInvoice ? () => onOpenInvoice(invoice) : undefined
                }
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
            No submitted invoices available.
          </Text>
        )}
      </DetailCard>

      <DetailCard title="Recent payments">
        {details.data.payments?.length ? (
          <View style={styles.invoiceList}>
            {details.data.payments.map((payment) => (
              <CustomerPaymentRow
                currency={currency}
                currencyPrecision={currencyPrecision}
                key={payment.name}
                onPress={
                  onOpenPaymentEntry
                    ? () => onOpenPaymentEntry(payment)
                    : undefined
                }
                payment={payment}
              />
            ))}
          </View>
        ) : (
          <Text style={[styles.detailText, { color: palette.onSurfaceMuted }]}>
            No permitted Payment Entries available.
          </Text>
        )}
      </DetailCard>

      {canReceivePayment ? (
        <Pressable
          accessibilityLabel="Receive payment"
          disabled={isOffline}
          onPress={() => onReceivePayment?.(saleCustomer)}
          style={[
            styles.receivePaymentButton,
            { borderColor: palette.border },
            isOffline && styles.actionDisabled,
          ]}
        >
          <Text
            style={[styles.receivePaymentButtonLabel, { color: palette.onSurface }]}
          >
            Receive payment
          </Text>
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel="Start new sale"
        disabled={isOffline}
        onPress={() => onStartSale(saleCustomer)}
        style={[
          styles.startSaleButton,
          { backgroundColor: palette.primary },
          isOffline && styles.actionDisabled,
        ]}
      >
        <Text style={[styles.startSaleButtonLabel, { color: palette.onPrimary }]}>
          Start new sale
        </Text>
      </Pressable>
      {isOffline ? (
        <Text
          accessibilityRole="alert"
          style={[styles.offlineNotice, { color: palette.onSurfaceMuted }]}
        >
          Reconnect to the server to start a sale or receive payment for this customer.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  actionDisabled: { opacity: 0.5 },
  backButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  backIconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  detailText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  errorText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    textAlign: "center",
  },
  receivePaymentButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  receivePaymentButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  heading: { flex: 1, gap: 4 },
  invoiceAmount: { flex: 1, gap: 2 },
  invoiceAmountLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  invoiceAmountValue: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  invoiceAmounts: { flexDirection: "row", gap: spacing.sm },
  invoiceDate: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  invoiceIdentity: { flex: 1, gap: 2 },
  invoiceList: { gap: spacing.sm },
  invoiceName: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  invoiceRow: {
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  invoiceRowHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  invoiceStatus: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  paymentMode: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  offlineNotice: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  state: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center",
    padding: spacing.lg,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  startSaleButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    padding: spacing.md,
  },
  startSaleButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  subtitle: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  summarySubtext: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  summaryText: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  summaryValue: {
    borderRadius: radii.md,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    padding: spacing.sm,
  },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
});
