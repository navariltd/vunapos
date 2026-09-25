import { useEffect, useState } from "react";
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
import { useToast } from "@/components/feedback/ToastProvider";
import { formatPosCurrency } from "@/features/pos/currency";
import { useClosePosShift } from "@/features/pos/hooks/useClosePosShift";
import { usePosClosingPreview } from "@/features/pos/hooks/usePosClosingPreview";
import { PosClosingPreviewInvoice, PosSession } from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCloseShiftScreenProps = {
  currency?: string;
  currencyPrecision?: number;
  onBackToPos: () => void;
  onShiftClosed?: (session: PosSession) => void;
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
  onShiftClosed,
  posProfile,
}: PosCloseShiftScreenProps) {
  const { palette } = useAppearance();
  const toast = useToast();
  const { connectionStatus } = useNetworkStatus();
  const preview = usePosClosingPreview(posProfile);
  const closeShift = useClosePosShift();
  const [countedAmounts, setCountedAmounts] = useState<Record<string, string>>(
    {},
  );
  const [confirmationVisible, setConfirmationVisible] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  useEffect(() => {
    const message = validationError || preview.error || closeShift.error;
    if (message) {
      toast.error(message, {
        dedupeKey: `close-shift-error:${message}`,
        title: "Close shift needs attention",
      });
    }
  }, [closeShift.error, preview.error, toast, validationError]);

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

    closeShift.clearError();
    setValidationError(null);
    setConfirmationVisible(true);
  }

  async function confirmClose() {
    if (!preview.data || !posProfile || closeShift.isClosing) return;
    const closingBalances = preview.data.payments.map((payment) => ({
      closing_amount:
        parseAmountInput(
          countedAmount(payment.mode_of_payment, payment.expected_amount),
        ) ?? 0,
      mode_of_payment: payment.mode_of_payment,
    }));
    const result = await closeShift.close({ closingBalances, posProfile });
    if (!result) return;
    setConfirmationVisible(false);
    onShiftClosed?.(result.session);
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
            {preview.data.payment_activity ? (
              <View
                style={[
                  styles.activityCard,
                  {
                    backgroundColor: palette.surfaceContainer,
                    borderColor: palette.border,
                  },
                ]}
              >
                <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>
                  Shift payment activity
                </Text>
                <Text
                  style={[styles.activityDescription, { color: palette.onSurfaceMuted }]}
                >
                  Credit sales are reported as sales, but only their deposits are
                  included in cash received. Reconciled credits are allocations only.
                </Text>
                <View style={styles.activityGrid}>
                  <ActivityValue
                    label="Checkout collections"
                    value={preview.data.payment_activity.sales_collected}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Credit sales"
                    value={preview.data.payment_activity.credit_sales}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Credit outstanding"
                    value={preview.data.payment_activity.credit_outstanding}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Old invoice payments"
                    value={preview.data.payment_activity.outstanding_invoice_payments}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Customer advances"
                    value={preview.data.payment_activity.customer_advances}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Credits reconciled"
                    value={preview.data.payment_activity.reconciled_existing_credits}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                  <ActivityValue
                    label="Cash received"
                    value={preview.data.payment_activity.cash_received}
                    currency={currency}
                    currencyPrecision={currencyPrecision}
                  />
                </View>
              </View>
            ) : null}
            <View
              style={[
                styles.salesCard,
                {
                  backgroundColor: palette.surfaceContainer,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.salesHeading}>
                <View style={styles.heading}>
                  <Text
                    style={[styles.sectionTitle, { color: palette.onSurface }]}
                  >
                    Sales in this shift
                  </Text>
                  <Text
                    style={[
                      styles.paymentMeta,
                      { color: palette.onSurfaceMuted },
                    ]}
                  >
                    Invoices included in this closing reconciliation.
                  </Text>
                </View>
                <Text style={[styles.salesCount, { color: palette.onSurface }]}>
                  {preview.data.invoice_count} total
                </Text>
              </View>
              {(preview.data.invoices ?? []).length ? (
                <View style={styles.salesList}>
                  {(preview.data.invoices ?? []).map((invoice) => (
                    <ShiftSaleCard
                      currency={currency}
                      currencyPrecision={currencyPrecision}
                      invoice={invoice}
                      key={`${invoice.doctype}:${invoice.name}`}
                    />
                  ))}
                </View>
              ) : (
                <View
                  style={[
                    styles.noSalesState,
                    { backgroundColor: palette.surface },
                  ]}
                >
                  <Text
                    style={[styles.paymentMeta, { color: palette.onSurfaceMuted }]}
                  >
                    No submitted VunaPOS invoices belong to this opening session
                    yet.
                  </Text>
                </View>
              )}
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
          error={closeShift.error}
          grandTotal={preview.data.grand_total}
          invoiceCount={preview.data.invoice_count}
          isOffline={connectionStatus !== "online"}
          isClosing={closeShift.isClosing}
          onConfirm={() => void confirmClose()}
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

function ActivityValue({
  currency,
  currencyPrecision,
  label,
  value,
}: {
  currency: string;
  currencyPrecision: number;
  label: string;
  value: number;
}) {
  const { palette } = useAppearance();
  return (
    <View
      style={[
        styles.activityValue,
        { backgroundColor: palette.surface, borderColor: palette.borderSubtle },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: palette.onSurfaceMuted }]}>
        {label}
      </Text>
      <Text style={[styles.activityAmount, { color: palette.onSurface }]}>
        {formatPosCurrency(value, currency, currencyPrecision)}
      </Text>
    </View>
  );
}

function ShiftSaleCard({
  currency,
  currencyPrecision,
  invoice,
}: {
  currency: string;
  currencyPrecision: number;
  invoice: PosClosingPreviewInvoice;
}) {
  const { palette } = useAppearance();
  const date = invoice.posting_date
    ? invoice.posting_date.split("-").reverse().join("/")
    : "-";
  const time = invoice.posting_time?.split(".")[0]?.slice(0, 5);

  return (
    <View
      style={[
        styles.saleRow,
        { backgroundColor: palette.surface, borderColor: palette.borderSubtle },
      ]}
    >
      <View style={styles.saleIdentity}>
        <View style={styles.saleNameRow}>
          <Text style={[styles.saleName, { color: palette.onSurface }]}>
            {invoice.name}
          </Text>
          {invoice.is_return ? (
            <View
              style={[
                styles.returnTag,
                { backgroundColor: palette.errorSurface },
              ]}
            >
              <Text style={[styles.returnTagLabel, { color: palette.onError }]}>
                Return
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.paymentMeta, { color: palette.onSurfaceMuted }]}>
          {time ? `${date} · ${time}` : date}
        </Text>
        <Text style={[styles.paymentMeta, { color: palette.onSurfaceMuted }]}>
          {invoice.customer || "-"}
        </Text>
      </View>
      <Text style={[styles.saleTotal, { color: palette.onSurface }]}>
        {formatPosCurrency(invoice.grand_total, currency, currencyPrecision)}
      </Text>
    </View>
  );
}

function CloseShiftCountConfirmationDialog({
  countedAmounts,
  currency,
  currencyPrecision,
  error,
  grandTotal,
  invoiceCount,
  isOffline,
  isClosing,
  onConfirm,
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
  error: string | null;
  grandTotal: number;
  invoiceCount: number;
  isOffline: boolean;
  isClosing: boolean;
  onConfirm: () => void;
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
          {error ? (
            <StateCard message={error} palette={palette} tone="error" />
          ) : null}
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
            <Pressable
              accessibilityLabel="Close POS Shift"
              accessibilityRole="button"
              disabled={isClosing || isOffline}
              onPress={onConfirm}
              style={[
                styles.closeButton,
                { backgroundColor: palette.error },
                (isClosing || isOffline) && styles.disabled,
              ]}
            >
              {isClosing ? (
                <ActivityIndicator color={palette.onPrimary} size="small" />
              ) : (
                <Text
                  style={[
                    styles.reviewButtonLabel,
                    { color: palette.onPrimary },
                  ]}
                >
                  Close POS Shift
                </Text>
              )}
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
  activityAmount: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  activityCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  activityDescription: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  activityGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  activityValue: {
    borderRadius: radii.sm,
    borderWidth: 1,
    flexGrow: 1,
    gap: 2,
    minWidth: "46%",
    padding: spacing.sm,
  },
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
  closeButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    minWidth: 132,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
  disabled: { opacity: 0.5 },
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
  noSalesState: { borderRadius: radii.sm, padding: spacing.sm },
  returnTag: {
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  returnTagLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.tiny,
  },
  saleIdentity: { flex: 1, gap: 2 },
  saleName: {
    flexShrink: 1,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  saleNameRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  saleRow: {
    alignItems: "flex-start",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  saleTotal: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    textAlign: "right",
  },
  salesCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  salesCount: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  salesHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  salesList: { gap: spacing.sm },
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
