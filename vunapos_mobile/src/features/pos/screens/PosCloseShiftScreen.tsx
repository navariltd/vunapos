import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { KeyboardAwareFormScroll } from "@/components/layout/KeyboardAwareFormScroll";
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
  const [countedAmounts, setCountedAmounts] = useState<Record<string, string>>(
    {},
  );
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

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

  function countedAmount(modeOfPayment: string, expectedAmount: number) {
    return countedAmounts[modeOfPayment] ?? formatAmountInput(expectedAmount);
  }

  function reviewCounts() {
    if (!preview.data || connectionStatus !== "online") return;

    for (const payment of preview.data.payments) {
      const rawAmount = countedAmount(
        payment.mode_of_payment,
        payment.expected_amount,
      );
      if (!rawAmount.trim()) {
        setValidationError(
          `Enter a counted amount for ${payment.mode_of_payment}.`,
        );
        return;
      }
      const amount = parseAmountInput(rawAmount);
      if (amount === null || amount < 0) {
        setValidationError(
          `Enter a valid counted amount for ${payment.mode_of_payment}.`,
        );
        return;
      }
    }

    setValidationError(null);
    setConfirmationVisible(true);
  }

  return (
    <>
      <KeyboardAwareFormScroll
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: palette.background }}
      >
        <View style={styles.header}>
          <View style={styles.heading}>
            <Text style={[styles.title, { color: palette.onSurface }]}>
              Close POS Shift
            </Text>
            <Text
              style={[styles.description, { color: palette.onSurfaceMuted }]}
            >
              Reconcile the till and close {posProfile}.
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Back to POS"
            accessibilityRole="button"
            onPress={onBackToPos}
            style={[styles.backButton, { borderColor: palette.border }]}
          >
            <Text
              style={[styles.backButtonLabel, { color: palette.onSurface }]}
            >
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
            <View
              style={[
                styles.reconciliationCard,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                },
              ]}
            >
              <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>
                Payment reconciliation
              </Text>
              {validationError ? (
                <StateCard
                  message={validationError}
                  palette={palette}
                  tone="error"
                />
              ) : null}
              {preview.data.payments.length ? (
                preview.data.payments.map((payment) => {
                  const rawAmount = countedAmount(
                    payment.mode_of_payment,
                    payment.expected_amount,
                  );
                  const counted = parseAmountInput(rawAmount);
                  const difference =
                    rawAmount.trim() && counted !== null
                      ? counted - payment.expected_amount
                      : null;
                  return (
                    <View
                      key={payment.mode_of_payment}
                      style={[
                        styles.paymentRow,
                        {
                          backgroundColor: palette.surfaceContainer,
                          borderColor: palette.borderSubtle,
                        },
                      ]}
                    >
                      <View style={styles.paymentHeading}>
                        <Text
                          style={[
                            styles.paymentMode,
                            { color: palette.onSurface },
                          ]}
                        >
                          {payment.mode_of_payment}
                        </Text>
                        <Text
                          style={[
                            styles.paymentMeta,
                            { color: palette.onSurfaceMuted },
                          ]}
                        >
                          Expected{" "}
                          {formatPosCurrency(
                            payment.expected_amount,
                            currency,
                            currencyPrecision,
                          )}
                        </Text>
                      </View>
                      <TextInput
                        accessibilityLabel={`Counted amount ${payment.mode_of_payment}`}
                        inputMode="decimal"
                        keyboardType="decimal-pad"
                        onChangeText={(value) =>
                          setCountedAmounts((current) => ({
                            ...current,
                            [payment.mode_of_payment]: formatAmountInput(value),
                          }))
                        }
                        placeholder="Counted amount"
                        placeholderTextColor={palette.onSurfaceMuted}
                        style={[
                          styles.countedInput,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.border,
                            color: palette.onSurface,
                          },
                        ]}
                        value={rawAmount}
                      />
                      <Text
                        style={[
                          styles.paymentMeta,
                          { color: palette.onSurfaceMuted },
                        ]}
                      >
                        Difference:{" "}
                        {difference === null
                          ? "-"
                          : formatPosCurrency(
                              difference,
                              currency,
                              currencyPrecision,
                            )}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text
                  style={[
                    styles.paymentMeta,
                    { color: palette.onSurfaceMuted },
                  ]}
                >
                  No payment modes need closing reconciliation.
                </Text>
              )}
            </View>
            <Pressable
              accessibilityLabel="Review shift counts"
              accessibilityRole="button"
              onPress={reviewCounts}
              style={[
                styles.reviewButton,
                { backgroundColor: palette.primary },
              ]}
            >
              <Text
                style={[styles.reviewButtonLabel, { color: palette.onPrimary }]}
              >
                Review shift counts
              </Text>
            </Pressable>
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
      </KeyboardAwareFormScroll>
      {preview.data ? (
        <CloseShiftCountConfirmationDialog
          countedAmounts={preview.data.payments.map((payment) => ({
            countedAmount: parseAmountInput(
              countedAmount(payment.mode_of_payment, payment.expected_amount),
            ),
            expectedAmount: payment.expected_amount,
            modeOfPayment: payment.mode_of_payment,
          }))}
          currency={currency}
          currencyPrecision={currencyPrecision}
          grandTotal={preview.data.grand_total}
          invoiceCount={preview.data.invoice_count}
          onDismiss={() => setConfirmationVisible(false)}
          visible={confirmationVisible}
        />
      ) : null}
    </>
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

function CloseShiftCountConfirmationDialog({
  countedAmounts,
  currency,
  currencyPrecision,
  grandTotal,
  invoiceCount,
  onDismiss,
  visible,
}: {
  countedAmounts: {
    countedAmount: number | null;
    expectedAmount: number;
    modeOfPayment: string;
  }[];
  currency: string;
  currencyPrecision: number;
  grandTotal: number;
  invoiceCount: number;
  onDismiss: () => void;
  visible: boolean;
}) {
  const { palette } = useAppearance();

  return (
    <Modal
      animationType="fade"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={[styles.modalBackdrop, { backgroundColor: palette.scrim }]}>
        <Pressable
          accessibilityLabel="Dismiss shift count review"
          onPress={onDismiss}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.confirmationDialog,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text
            style={[styles.confirmationTitle, { color: palette.onSurface }]}
          >
            Review shift counts
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            Confirm the totals below before closing this POS shift.
          </Text>
          <View style={styles.confirmationSummary}>
            <ConfirmationValue label="Invoices" value={String(invoiceCount)} />
            <ConfirmationValue
              label="Grand total"
              value={formatPosCurrency(grandTotal, currency, currencyPrecision)}
            />
          </View>
          <View
            style={[styles.confirmedCounts, { borderColor: palette.border }]}
          >
            <Text
              style={[
                styles.confirmedCountsTitle,
                { color: palette.onSurfaceMuted },
              ]}
            >
              Counted amounts
            </Text>
            {countedAmounts.map((payment) => {
              const difference =
                payment.countedAmount === null
                  ? null
                  : payment.countedAmount - payment.expectedAmount;
              return (
                <View key={payment.modeOfPayment} style={styles.confirmedRow}>
                  <Text
                    style={[styles.paymentMeta, { color: palette.onSurface }]}
                  >
                    {payment.modeOfPayment}
                  </Text>
                  <Text
                    style={[
                      styles.confirmedAmount,
                      { color: palette.onSurface },
                    ]}
                  >
                    {payment.countedAmount === null
                      ? "-"
                      : formatPosCurrency(
                          payment.countedAmount,
                          currency,
                          currencyPrecision,
                        )}{" "}
                    {difference === null ? null : (
                      <Text
                        style={[
                          styles.confirmedDifference,
                          { color: palette.onSurfaceMuted },
                        ]}
                      >
                        (
                        {formatPosCurrency(
                          difference,
                          currency,
                          currencyPrecision,
                        )}{" "}
                        difference)
                      </Text>
                    )}
                  </Text>
                </View>
              );
            })}
          </View>
          <View style={styles.confirmationActions}>
            <Pressable
              accessibilityLabel="Back to shift counts"
              accessibilityRole="button"
              onPress={onDismiss}
              style={[styles.backButton, { borderColor: palette.border }]}
            >
              <Text
                style={[styles.backButtonLabel, { color: palette.onSurface }]}
              >
                Back to counts
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ConfirmationValue({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  return (
    <View style={styles.confirmationValue}>
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
  content: { flexGrow: 1, gap: spacing.lg, padding: spacing.md },
  confirmationActions: { alignItems: "flex-end" },
  confirmationDialog: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    width: "100%",
  },
  confirmationSummary: { flexDirection: "row", gap: spacing.lg },
  confirmationTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 20,
  },
  confirmationValue: { flex: 1, gap: 2 },
  confirmedAmount: {
    flexShrink: 1,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    textAlign: "right",
  },
  confirmedCounts: {
    borderTopWidth: 1,
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  confirmedCountsTitle: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    textTransform: "uppercase",
  },
  confirmedDifference: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.tiny,
  },
  confirmedRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  countedInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
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
  modalBackdrop: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  paymentHeading: { gap: 2 },
  paymentMeta: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  paymentMode: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  paymentRow: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  reconciliationCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
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
  reviewButton: {
    alignItems: "center",
    alignSelf: "flex-end",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  reviewButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
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
  sectionTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
  },
});

function parseAmountInput(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^-?\d+(?:\.\d*)?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function formatAmountInput(value: string | number) {
  const input = String(value).trim();
  const negative = input.startsWith("-");
  const normalized = input.replace(/,/g, "").replace(/[^\d.]/g, "");
  if (!normalized) return negative ? "-" : "";

  const [integer, ...decimalParts] = normalized.split(".");
  const decimal = decimalParts.join("");
  const formattedInteger = integer
    ? Number(integer).toLocaleString(undefined, { maximumFractionDigits: 0 })
    : "0";

  const formatted = decimalParts.length
    ? `${formattedInteger}.${decimal}`
    : formattedInteger;
  return negative ? `-${formatted}` : formatted;
}
