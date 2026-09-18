import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { PosErpNextRecordLink } from "@/features/pos/components/PosErpNextRecordLink";
import { PosFixedPageHeader } from "@/features/pos/components/PosFixedPageHeader";
import { PosInvoiceReturnPreviewSheet } from "@/features/pos/components/PosInvoiceReturnPreviewSheet";
import { PosInvoiceReceiptActions } from "@/features/pos/components/PosInvoiceReceiptActions";
import { formatPosCurrency } from "@/features/pos/currency";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { usePosInvoiceDetails } from "@/features/pos/hooks/usePosInvoiceDetails";
import { usePosWorkflowActions } from "@/features/pos/hooks/usePosWorkflowActions";
import {
  PosCartSource,
  PosInvoiceDetail,
  PosInvoiceDetailItem,
  PosInvoicePaymentEntry,
  PosInvoiceReturn,
  PosInvoiceStatus,
  PosSaleCustomer,
} from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

type PosInvoiceDetailsScreenProps = {
  invoiceDoctype?: string;
  invoiceName: string;
  onBack: () => void;
  onEditDraft?: (source: PosCartSource) => Promise<void>;
  onOpenCustomer: (customer: string) => void;
  onOpenPaymentEntry: (
    paymentEntry: PosInvoicePaymentEntry,
    currency: string,
  ) => void;
  onOpenReturn: (invoiceReturn: PosInvoiceReturn) => void;
  onReceivePayment?: (customer: PosSaleCustomer, invoice: string) => void;
  onStartSale: (customer: PosSaleCustomer) => void;
};

function createStatusStyles(
  palette: AppPalette,
): Record<PosInvoiceStatus, { backgroundColor: string; color: string }> {
  return {
    "Credit Note": {
      backgroundColor: palette.surfaceContainerHigh,
      color: palette.onSurface,
    },
    Draft: {
      backgroundColor: palette.surfaceContainerHigh,
      color: palette.onSurface,
    },
    Cancelled: { backgroundColor: palette.errorSurface, color: palette.error },
    Overdue: { backgroundColor: palette.errorSurface, color: palette.error },
    Paid: { backgroundColor: palette.surfaceContainer, color: palette.success },
    "Partly Paid": {
      backgroundColor: palette.surfaceContainerHigh,
      color: palette.onSurface,
    },
    Unpaid: { backgroundColor: palette.errorSurface, color: palette.error },
  };
}

function formatDate(value?: string) {
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

function formatDateTime(details: PosInvoiceDetail) {
  const date = formatDate(details.posting_date);
  const time = details.posting_time?.split(".")[0]?.slice(0, 5);
  return time ? `${date} · ${time}` : date;
}

function paymentLabel(
  mode: string,
  transactionReference?: string,
  paymentRequest?: string,
) {
  const reference = transactionReference || paymentRequest;
  return reference ? `${mode} · ${reference}` : mode;
}

function formatBatchAllocations(item: PosInvoiceDetailItem) {
  const allocations = item.batch_allocations
    ?.filter((allocation) => allocation.batch_no)
    .map((allocation) => `${allocation.batch_no} (${allocation.qty})`)
    .join(", ");

  return allocations || item.batch_no || null;
}

function DetailCard({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
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

function KeyValue({ label, value }: { label: string; value?: string }) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.keyText}>
        {value || "-"}
      </Text>
    </View>
  );
}

export function PosInvoiceDetailsScreen({
  invoiceDoctype,
  invoiceName,
  onBack,
  onEditDraft,
  onOpenCustomer,
  onOpenPaymentEntry,
  onOpenReturn,
  onReceivePayment,
  onStartSale,
}: PosInvoiceDetailsScreenProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  const { connectionStatus } = useNetworkStatus();
  const isOffline = connectionStatus !== "online";
  const [returnPreviewVisible, setReturnPreviewVisible] = useState(false);
  const [workflowActionsVisible, setWorkflowActionsVisible] = useState(false);
  const bootstrap = usePosBootstrap();
  const details = usePosInvoiceDetails({
    invoiceDoctype,
    invoiceName,
    posProfile: bootstrap.data?.pos_profile.name,
  });
  const workflowActions = usePosWorkflowActions({
    doctype: invoiceDoctype || "Sales Invoice",
    name: invoiceName,
    posProfile: bootstrap.data?.pos_profile.name,
  });
  const error = bootstrap.error ?? details.error;

  if (bootstrap.isLoading || details.isLoading) {
    return (
      <View style={styles.state}>
        <Text style={styles.stateText}>Loading invoice…</Text>
      </View>
    );
  }

  if (!details.data || error) {
    return (
      <View style={styles.state}>
        <Text style={styles.errorText}>{error || "Invoice not found."}</Text>
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonLabel}>Back to invoices</Text>
        </Pressable>
      </View>
    );
  }

  const invoice = details.data;
  const currency =
    invoice.currency ?? bootstrap.data?.pos_profile.currency ?? "KES";
  const precision = bootstrap.data?.pos_profile.currency_precision ?? 2;
  const formatCurrency = (amount: number, amountCurrency = currency) =>
    formatPosCurrency(amount, amountCurrency, precision);
  const total = invoice.totals.rounded_total || invoice.totals.grand_total || 0;
  const statusStyle = createStatusStyles(palette)[invoice.status];
  const itemCount = invoice.items.reduce(
    (sum, item) => sum + Number(item.qty || 0),
    0,
  );
  const invoiceCustomer = invoice.customer;
  const outstandingAmount = invoice.totals.outstanding_amount || 0;
  const canReceivePayment = Boolean(
    bootstrap.data?.pos_profile.allow_customer_payments !== false &&
    invoice.doctype !== "Sales Order" &&
    invoiceCustomer &&
    outstandingAmount > 0 &&
    onReceivePayment,
  );
  const canStartReturn = Boolean(
    invoice.docstatus === 1 &&
    invoice.doctype !== "Sales Order" &&
    !invoice.is_return &&
    bootstrap.data?.pos_profile.name,
  );
  const canRunWorkflowAction = Boolean(
    invoice.docstatus === 0 && workflowActions.actions.length && !isOffline,
  );
  const canEditDraft = Boolean(
    invoice.docstatus === 0 &&
    invoice.can_edit !== false &&
    onEditDraft &&
    !isOffline,
  );

  return (
    <View style={styles.screen}>
      <PosFixedPageHeader>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to invoices"
            onPress={onBack}
            style={styles.backIconButton}
          >
            <MaterialCommunityIcons
              color={palette.onSurface}
              name="arrow-left"
              size={22}
            />
          </Pressable>
          <View style={styles.heading}>
            <View style={styles.titleRow}>
              <Text numberOfLines={1} style={styles.title}>
                {invoice.name}
              </Text>
              <View style={[styles.status, statusStyle]}>
                <Text
                  style={[styles.statusLabel, { color: statusStyle.color }]}
                >
                  {invoice.status}
                </Text>
              </View>
            </View>
            <Text style={styles.subtitle}>
              {formatDateTime(invoice)}
              {invoice.workflow_state ? ` · ${invoice.workflow_state}` : ""}
              {invoice.is_credit_sale && invoice.due_date
                ? ` · Due ${formatDate(invoice.due_date)}`
                : ""}
            </Text>
            {invoice.is_credit_sale ? (
              <Text style={styles.creditSale}>Credit sale</Text>
            ) : null}
          </View>
        </View>
      </PosFixedPageHeader>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryGrid}>
          <SummaryValue
            label="Grand total"
            value={formatPosCurrency(total, currency, precision)}
          />
          <SummaryValue
            label="Paid"
            value={formatPosCurrency(
              invoice.totals.paid_amount || 0,
              currency,
              precision,
            )}
          />
          <SummaryValue
            label="Outstanding"
            value={formatPosCurrency(
              invoice.totals.outstanding_amount || 0,
              currency,
              precision,
            )}
          />
          <SummaryValue label="Items" value={String(itemCount)} />
        </View>

        <PosInvoiceReceiptActions
          invoiceDoctype={invoice.doctype}
          invoiceName={invoice.name}
        />
        {canEditDraft ? (
          <Pressable
            accessibilityLabel="Edit draft invoice"
            onPress={() =>
              void onEditDraft?.({
                doctype: invoice.doctype,
                name: invoice.name,
              })
            }
            style={styles.editDraftButton}
          >
            <MaterialCommunityIcons
              color={palette.onSurface}
              name="pencil-outline"
              size={17}
            />
            <Text style={styles.editDraftButtonLabel}>Edit draft</Text>
          </Pressable>
        ) : null}
        {canRunWorkflowAction ? (
          <Pressable
            accessibilityLabel="Open workflow actions"
            onPress={() => setWorkflowActionsVisible(true)}
            style={styles.workflowActionsButton}
          >
            <Text style={styles.workflowActionsButtonLabel}>Actions</Text>
            <MaterialCommunityIcons
              color={palette.onPrimary}
              name="chevron-down"
              size={18}
            />
          </Pressable>
        ) : null}
        {workflowActions.error ? (
          <Text style={styles.workflowError}>{workflowActions.error}</Text>
        ) : null}
        <PosErpNextRecordLink doctype={invoice.doctype} name={invoice.name} />
        {canStartReturn ? (
          <Pressable
            accessibilityLabel="Return items"
            onPress={() => setReturnPreviewVisible(true)}
            style={styles.returnButton}
          >
            <Text style={styles.returnButtonLabel}>Return items</Text>
          </Pressable>
        ) : null}

        <DetailCard title="Customer">
          <Text style={styles.customerName}>
            {invoice.customer_name || invoiceCustomer || "No customer"}
          </Text>
          <Text style={styles.customerId}>{invoiceCustomer || "-"}</Text>
          {invoice.is_credit_sale ? (
            <View style={styles.keyValues}>
              <KeyValue
                label="Payment due"
                value={formatDate(invoice.due_date)}
              />
              <KeyValue
                label="Outstanding"
                value={formatCurrency(
                  invoice.totals.outstanding_amount || 0,
                  currency,
                )}
              />
            </View>
          ) : null}
          {invoiceCustomer ? (
            <View style={styles.customerActions}>
              <Pressable
                accessibilityLabel="View customer"
                disabled={isOffline}
                onPress={() => onOpenCustomer(invoiceCustomer)}
                style={styles.customerButton}
              >
                <Text style={styles.customerButtonLabel}>View customer</Text>
              </Pressable>
              {canReceivePayment ? (
                <Pressable
                  accessibilityLabel="Receive payment"
                  disabled={isOffline}
                  onPress={() =>
                    onReceivePayment?.(
                      {
                        customer: invoiceCustomer,
                        customerName: invoice.customer_name || invoiceCustomer,
                      },
                      invoice.name,
                    )
                  }
                  style={styles.customerButton}
                >
                  <Text style={styles.customerButtonLabel}>
                    Receive payment
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="Start new sale"
                disabled={isOffline}
                onPress={() =>
                  onStartSale({
                    customer: invoiceCustomer,
                    customerName: invoice.customer_name || invoiceCustomer,
                  })
                }
                style={styles.customerButton}
              >
                <Text style={styles.customerButtonLabel}>New sale</Text>
              </Pressable>
            </View>
          ) : null}
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
            {invoice.items.map((item) => {
              const batchAllocations = formatBatchAllocations(item);

              return (
                <View key={item.row_name} style={styles.itemRow}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName}>{item.item_name}</Text>
                    <Text style={styles.itemCode}>{item.item_code}</Text>
                    <Text style={styles.itemMeta}>
                      {item.qty} {item.uom || ""} ·{" "}
                      {formatCurrency(item.rate, currency)}
                    </Text>
                    {batchAllocations ? (
                      <Text style={styles.itemBatch}>
                        Batch · {batchAllocations}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.itemAmount}>
                    {formatCurrency(item.amount, currency)}
                  </Text>
                </View>
              );
            })}
          </View>
        </DetailCard>

        <DetailCard title="Checkout payments">
          <View style={styles.keyValues}>
            {invoice.loyalty_points ? (
              <KeyValue
                label="Loyalty points redeemed"
                value={invoice.loyalty_points.toLocaleString()}
              />
            ) : null}
            {invoice.loyalty_amount ? (
              <KeyValue
                label="Loyalty credit"
                value={formatCurrency(invoice.loyalty_amount, currency)}
              />
            ) : null}
            {invoice.payments?.length ? (
              invoice.payments.map((payment, index) => (
                <KeyValue
                  key={`${payment.mode_of_payment}-${payment.transaction_reference || payment.ke_payment_request || index}`}
                  label={paymentLabel(
                    payment.mode_of_payment,
                    payment.transaction_reference,
                    payment.ke_payment_request,
                  )}
                  value={formatCurrency(payment.amount, currency)}
                />
              ))
            ) : (
              <Text style={styles.emptyCardText}>
                {invoice.is_credit_sale
                  ? "No deposit was received at checkout."
                  : "No checkout payment rows."}
              </Text>
            )}
          </View>
        </DetailCard>

        <DetailCard title="Linked Payment Entries">
          {invoice.payment_entries?.length ? (
            <View style={styles.paymentEntryList}>
              {invoice.payment_entries.map((paymentEntry) => {
                const isCancelled = paymentEntry.docstatus === 2;

                return (
                  <Pressable
                    accessibilityLabel={`View payment ${paymentEntry.name}`}
                    key={paymentEntry.name}
                    onPress={() => onOpenPaymentEntry(paymentEntry, currency)}
                    style={styles.paymentEntryRow}
                  >
                    <View style={styles.paymentEntryMain}>
                      <Text style={styles.paymentEntryName}>
                        {paymentEntry.name}
                      </Text>
                      <Text style={styles.paymentEntryMeta}>
                        {formatDate(paymentEntry.posting_date || undefined)} ·{" "}
                        {paymentEntry.mode_of_payment || "Unspecified"}
                      </Text>
                      <Text
                        style={[
                          styles.paymentEntryStatus,
                          isCancelled && styles.paymentEntryCancelled,
                        ]}
                      >
                        {isCancelled ? "Cancelled" : "Submitted"}
                      </Text>
                    </View>
                    <Text style={styles.paymentEntryAmount}>
                      Allocated{" "}
                      {formatCurrency(paymentEntry.allocated_amount, currency)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyCardText}>No linked Payment Entries.</Text>
          )}
        </DetailCard>

        <DetailCard title="Returns and credit notes">
          {invoice.returns?.length ? (
            <View style={styles.returnList}>
              {invoice.returns.map((invoiceReturn) => {
                const isCancelled = invoiceReturn.docstatus === 2;

                return (
                  <Pressable
                    accessibilityLabel={`View credit note ${invoiceReturn.name}`}
                    key={invoiceReturn.name}
                    onPress={() => onOpenReturn(invoiceReturn)}
                    style={styles.returnRow}
                  >
                    <View style={styles.returnMain}>
                      <Text style={styles.returnName}>
                        {invoiceReturn.name}
                      </Text>
                      <Text style={styles.returnMeta}>
                        {formatDate(invoiceReturn.posting_date || undefined)}
                      </Text>
                      <Text
                        style={[
                          styles.returnStatus,
                          isCancelled && styles.returnCancelled,
                        ]}
                      >
                        {isCancelled ? "Cancelled" : "Submitted"}
                      </Text>
                    </View>
                    <Text style={styles.returnAmount}>
                      {formatCurrency(invoiceReturn.grand_total, currency)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyCardText}>
              No returns have been created.
            </Text>
          )}
        </DetailCard>

        <DetailCard title="Taxes and totals">
          <View style={styles.keyValues}>
            {invoice.taxes?.map((tax, index) => (
              <KeyValue
                key={`${tax.account_head || tax.description || "tax"}-${index}`}
                label={tax.description || tax.account_head || "Tax"}
                value={formatCurrency(tax.tax_amount || 0, currency)}
              />
            ))}
            <KeyValue
              label="Net total"
              value={formatCurrency(invoice.totals.net_total || 0, currency)}
            />
            <KeyValue
              label="Grand total"
              value={formatCurrency(total, currency)}
            />
            {invoice.loyalty_amount ? (
              <KeyValue
                label="Loyalty redemption"
                value={`−${formatCurrency(invoice.loyalty_amount, currency)}`}
              />
            ) : null}
          </View>
        </DetailCard>

        {canStartReturn && returnPreviewVisible ? (
          <PosInvoiceReturnPreviewSheet
            currencyPrecision={precision}
            currency={currency}
            invoiceName={invoice.name}
            onComplete={(returnInvoice) => {
              setReturnPreviewVisible(false);
              onOpenReturn(returnInvoice);
            }}
            onDismiss={() => setReturnPreviewVisible(false)}
            posProfile={bootstrap.data?.pos_profile.name || ""}
            visible={returnPreviewVisible}
          />
        ) : null}
      </ScrollView>
      <Modal
        animationType="fade"
        onRequestClose={() => setWorkflowActionsVisible(false)}
        transparent
        visible={workflowActionsVisible}
      >
        <View style={styles.workflowModalBackdrop}>
          <Pressable
            accessibilityLabel="Dismiss workflow actions"
            onPress={() => setWorkflowActionsVisible(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.workflowModalCard}>
            <Text style={styles.workflowModalTitle}>Actions</Text>
            {workflowActions.actions.map((transition) => (
              <Pressable
                accessibilityLabel={`Apply workflow action ${transition.action}`}
                disabled={Boolean(workflowActions.isApplying)}
                key={transition.action}
                onPress={() =>
                  void workflowActions
                    .apply(transition.action)
                    .then((applied) => {
                      if (!applied) return;
                      setWorkflowActionsVisible(false);
                      details.reload();
                    })
                }
                style={styles.workflowActionOption}
              >
                <Text style={styles.workflowActionOptionLabel}>
                  {workflowActions.isApplying === transition.action
                    ? "Applying…"
                    : transition.action}
                </Text>
                <Text style={styles.workflowActionNextState}>
                  {transition.next_state}
                </Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => setWorkflowActionsVisible(false)}
              style={styles.workflowModalCancel}
            >
              <Text style={styles.workflowModalCancelLabel}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
    backButton: {
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    backButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    backIconButton: {
      alignItems: "center",
      borderColor: palette.border,
      borderRadius: radii.pill,
      borderWidth: 1,
      height: 40,
      justifyContent: "center",
      width: 40,
    },
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
    content: {
      gap: spacing.md,
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    creditSale: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    customerId: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
    customerButton: {
      alignSelf: "flex-start",
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
    },
    customerButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    customerActions: { flexDirection: "row", gap: spacing.sm },
    customerName: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.body,
    },
    editDraftButton: {
      alignItems: "center",
      alignSelf: "flex-start",
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    editDraftButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    emptyCardText: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
    errorText: {
      color: palette.error,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.body,
      textAlign: "center",
    },
    header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
    heading: { flex: 1, gap: 4 },
    itemAmount: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    itemBatch: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    itemCode: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    itemList: { gap: spacing.sm },
    itemMain: { flex: 1, gap: 2 },
    itemMeta: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    itemName: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.medium,
      fontSize: typography.size.small,
    },
    itemRow: {
      alignItems: "flex-start",
      borderTopColor: palette.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    keyLabel: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    keyText: {
      color: palette.onSurface,
      flex: 1,
      fontFamily: typography.fontFamily.medium,
      fontSize: typography.size.small,
      textAlign: "right",
    },
    keyValue: {
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "space-between",
    },
    keyValues: { gap: spacing.xs },
    paymentEntryAmount: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
      textAlign: "right",
    },
    paymentEntryCancelled: { color: palette.error },
    paymentEntryList: { gap: spacing.sm },
    paymentEntryMain: { flex: 1, gap: 2 },
    paymentEntryMeta: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    paymentEntryName: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.medium,
      fontSize: typography.size.small,
    },
    paymentEntryRow: {
      alignItems: "flex-start",
      borderTopColor: palette.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    paymentEntryStatus: {
      color: palette.success,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    returnAmount: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
      textAlign: "right",
    },
    returnButton: {
      alignSelf: "flex-start",
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 9,
    },
    returnButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    screen: { flex: 1 },
    returnCancelled: { color: palette.error },
    returnList: { gap: spacing.sm },
    returnMain: { flex: 1, gap: 2 },
    returnMeta: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    returnName: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.medium,
      fontSize: typography.size.small,
    },
    returnRow: {
      alignItems: "flex-start",
      borderTopColor: palette.border,
      borderTopWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    returnStatus: {
      color: palette.success,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    state: {
      alignItems: "center",
      flex: 1,
      gap: spacing.md,
      justifyContent: "center",
      padding: spacing.lg,
    },
    stateText: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.body,
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
    subtitle: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
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
      flex: 1,
      fontFamily: typography.fontFamily.semibold,
      fontSize: 20,
    },
    titleRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.sm,
    },
    workflowActionNextState: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    workflowActionOption: {
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      gap: 2,
      padding: spacing.md,
    },
    workflowActionOptionLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.body,
    },
    workflowActionsButton: {
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: palette.primary,
      borderRadius: radii.md,
      flexDirection: "row",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    workflowActionsButtonLabel: {
      color: palette.onPrimary,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    workflowError: {
      color: palette.error,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
    workflowModalBackdrop: {
      alignItems: "center",
      backgroundColor: palette.scrim,
      flex: 1,
      justifyContent: "center",
      padding: spacing.lg,
    },
    workflowModalCancel: {
      alignItems: "center",
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingVertical: spacing.sm,
    },
    workflowModalCancelLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    workflowModalCard: {
      backgroundColor: palette.surfaceContainer,
      borderColor: palette.border,
      borderRadius: radii.lg,
      borderWidth: 1,
      gap: spacing.sm,
      maxWidth: 420,
      padding: spacing.lg,
      width: "100%",
    },
    workflowModalTitle: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: 19,
      marginBottom: spacing.xs,
    },
  });
}
