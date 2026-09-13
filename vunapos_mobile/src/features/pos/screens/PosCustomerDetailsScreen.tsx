import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosCustomerDetails } from "@/features/pos/hooks/usePosCustomerDetails";
import { formatPosCurrency } from "@/features/pos/currency";
import { PosCustomerAddress, PosSaleCustomer } from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCustomerDetailsScreenProps = {
  customer: string;
  onBack: () => void;
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

export function PosCustomerDetailsScreen({
  customer,
  onBack,
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
          Reconnect to the server to start a sale for this customer.
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
