import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { PosErpNextRecordLink } from "@/features/pos/components/PosErpNextRecordLink";
import { formatPosCurrency } from "@/features/pos/currency";
import { PosInvoicePaymentEntry } from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type PosPaymentEntryDetailsScreenProps = {
  currency: string;
  currencyPrecision?: number;
  onBack: () => void;
  paymentEntry: PosInvoicePaymentEntry;
};

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

function SummaryValue({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View style={styles.summaryValue}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryText}>
        {value}
      </Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.detailValue}>
        {value}
      </Text>
    </View>
  );
}

/** Compact native summary for a Payment Entry linked to the current invoice. */
export function PosPaymentEntryDetailsScreen({
  currency,
  currencyPrecision = 2,
  onBack,
  paymentEntry,
}: PosPaymentEntryDetailsScreenProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const formatCurrency = (amount: number) =>
    formatPosCurrency(amount, currency, currencyPrecision);
  const isCancelled = paymentEntry.docstatus === 2;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back to invoice"
          onPress={onBack}
          style={styles.backButton}
        >
          <MaterialCommunityIcons
            color={palette.onSurface}
            name="arrow-left"
            size={22}
          />
        </Pressable>
        <View style={styles.heading}>
          <Text style={styles.eyebrow}>Payment Entry</Text>
          <Text numberOfLines={1} style={styles.title}>
            {paymentEntry.name}
          </Text>
          <View
            style={[
              styles.status,
              isCancelled ? styles.cancelledStatus : styles.submittedStatus,
            ]}
          >
            <Text
              style={[
                styles.statusLabel,
                isCancelled ? styles.cancelledLabel : styles.submittedLabel,
              ]}
            >
              {isCancelled ? "Cancelled" : "Submitted"}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryValue
          label="Received"
          value={formatCurrency(paymentEntry.received_amount)}
        />
        <SummaryValue
          label="Applied to invoice"
          value={formatCurrency(paymentEntry.allocated_amount)}
        />
        <SummaryValue
          label="Unallocated"
          value={formatCurrency(paymentEntry.unallocated_amount)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Payment details</Text>
        <View style={styles.details}>
          <DetailRow
            label="Posting date"
            value={formatDate(paymentEntry.posting_date)}
          />
          <DetailRow
            label="Payment mode"
            value={paymentEntry.mode_of_payment || "Unspecified"}
          />
          <DetailRow
            label="Status"
            value={isCancelled ? "Cancelled" : "Submitted"}
          />
        </View>
      </View>

      <PosErpNextRecordLink doctype="Payment Entry" name={paymentEntry.name} />
    </ScrollView>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
  backButton: {
    alignItems: "center",
    borderColor: palette.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  cancelledLabel: { color: palette.error },
  cancelledStatus: { backgroundColor: palette.errorSurface },
  card: {
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardTitle: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  detailLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  detailRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  detailValue: {
    color: palette.onSurface,
    flex: 1,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    textAlign: "right",
  },
  details: { gap: spacing.sm },
  eyebrow: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  heading: { flex: 1, gap: 4 },
  status: {
    alignSelf: "flex-start",
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  submittedLabel: { color: palette.success },
  submittedStatus: { backgroundColor: palette.surfaceContainer },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryLabel: {
    color: palette.onSurfaceMuted,
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  summaryText: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  summaryValue: {
    backgroundColor: palette.surfaceContainer,
    borderRadius: radii.md,
    flexBasis: "47%",
    flexGrow: 1,
    gap: 4,
    padding: spacing.sm,
  },
  title: {
    color: palette.onSurface,
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  });
}
