import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { usePosClosingPreview } from "@/features/pos/hooks/usePosClosingPreview";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCloseShiftScreenProps = {
  currency?: string;
  currencyPrecision?: number;
  onBackToPos: () => void;
  posProfile?: string;
};

/**
 * Entry point for the server-authoritative POS closing workflow. The preview
 * and reconciliation stages are added here incrementally.
 */
export function PosCloseShiftScreen({
  currency = "KES",
  currencyPrecision = 2,
  onBackToPos,
  posProfile,
}: PosCloseShiftScreenProps) {
  const { palette } = useAppearance();
  const { connectionStatus } = useNetworkStatus();
  const preview = usePosClosingPreview(posProfile);

  if (!posProfile) {
    return (
      <View
        accessibilityRole="progressbar"
        style={[styles.state, { backgroundColor: palette.background }]}
      >
        <ActivityIndicator color={palette.primary} />
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading POS profile for shift closing…
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.content, { backgroundColor: palette.background }]}>
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Close POS Shift
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            Reconcile the till and close {posProfile}.
          </Text>
        </View>
        <Pressable
          accessibilityLabel="Back to POS"
          accessibilityRole="button"
          onPress={onBackToPos}
          style={[styles.backButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Back to POS
          </Text>
        </Pressable>
      </View>

      {connectionStatus !== "online" ? (
        <StateCard
          message={
            connectionStatus === "offline"
              ? "Reconnect to the server before closing this shift."
              : "Checking the server connection before closing this shift."
          }
          palette={palette}
          tone="error"
        />
      ) : preview.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={palette.primary} />
          <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
            Loading shift totals…
          </Text>
        </View>
      ) : preview.error ? (
        <StateCard message={preview.error} palette={palette} tone="error">
          <Pressable
            accessibilityLabel="Retry closing preview"
            accessibilityRole="button"
            onPress={preview.reload}
            style={[styles.retryButton, { borderColor: palette.border }]}
          >
            <Text
              style={[styles.backButtonLabel, { color: palette.onSurface }]}
            >
              Retry
            </Text>
          </Pressable>
        </StateCard>
      ) : preview.data ? (
        <>
          <View style={styles.summaryGrid}>
            <SummaryCard
              label="Invoices"
              value={String(preview.data.invoice_count)}
            />
            <SummaryCard
              label="Net sales"
              value={formatPosCurrency(
                preview.data.net_total,
                currency,
                currencyPrecision,
              )}
            />
            <SummaryCard
              label="Grand total"
              value={formatPosCurrency(
                preview.data.grand_total,
                currency,
                currencyPrecision,
              )}
            />
          </View>
          <Pressable
            accessibilityLabel="Refresh shift totals"
            accessibilityRole="button"
            onPress={preview.reload}
            style={[styles.refreshButton, { borderColor: palette.border }]}
          >
            <Text
              style={[styles.backButtonLabel, { color: palette.onSurface }]}
            >
              Refresh totals
            </Text>
          </Pressable>
        </>
      ) : (
        <StateCard
          message="Unable to load closing summary."
          palette={palette}
          tone="error"
        />
      )}
    </View>
  );
}

function StateCard({
  children,
  message,
  palette,
  tone,
}: {
  children?: React.ReactNode;
  message: string;
  palette: ReturnType<typeof useAppearance>["palette"];
  tone: "error";
}) {
  return (
    <View
      accessibilityRole="alert"
      style={[
        styles.stateCard,
        {
          backgroundColor:
            tone === "error" ? palette.errorSurface : palette.surface,
          borderColor: tone === "error" ? palette.error : palette.border,
        },
      ]}
    >
      <Text style={[styles.stateText, { color: palette.onError }]}>
        {message}
      </Text>
      {children}
    </View>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  return (
    <View
      style={[
        styles.summaryCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: palette.onSurfaceMuted }]}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: palette.onSurface }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  content: { flex: 1, gap: spacing.lg, padding: spacing.md },
  description: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  heading: { flex: 1, gap: 4 },
  loadingState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
  },
  refreshButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  stateCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  state: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  summaryCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    minWidth: "30%",
    padding: spacing.md,
  },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summaryLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
  },
  summaryValue: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
  },
});
