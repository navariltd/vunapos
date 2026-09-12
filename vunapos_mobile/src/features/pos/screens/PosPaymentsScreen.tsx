import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { usePosCustomerDetails } from "@/features/pos/hooks/usePosCustomerDetails";
import { usePosCustomerSearch } from "@/features/pos/hooks/usePosCustomerSearch";
import { usePosPaymentReconciliationAllocation } from "@/features/pos/hooks/usePosPaymentReconciliationAllocation";
import { usePosPaymentReconciliationCandidates } from "@/features/pos/hooks/usePosPaymentReconciliationCandidates";
import { useReceiveCustomerPayment } from "@/features/pos/hooks/useReceiveInvoicePayment";
import { useGatewayPayment } from "@/features/pos/hooks/useGatewayPayment";
import { useGatewayPaymentRealtime } from "@/features/pos/hooks/useGatewayPaymentRealtime";
import {
  PosC2BGatewayPayment,
  PosCustomerSearchResult,
  PosGatewayPaymentLink,
  PosPaymentMode,
  PosPaymentReconciliationAllocation,
  PosPaymentReconciliationCandidate,
} from "@/features/pos/types";
import {
  parsePaymentAmount,
  totalToMinorUnits,
} from "@/features/pos/paymentAllocation";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PaymentWorkspaceTab = "receive" | "reconcile" | "history";

type PosPaymentsScreenProps = {
  allowHistory: boolean;
  allowReconciliation: boolean;
  allowReceive: boolean;
  currency: string;
  currencyPrecision: number;
  onBackToPos: () => void;
  paymentModes: PosPaymentMode[];
  posProfile?: string;
};

const tabDefinitions: { label: string; value: PaymentWorkspaceTab }[] = [
  { label: "Receive", value: "receive" },
  { label: "Reconcile", value: "reconcile" },
  { label: "History", value: "history" },
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateFromInput(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dateFromInput(value));
}

function createGatewayIdempotencyKey(modeOfPayment: string) {
  return `mobile-gateway-${modeOfPayment}-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The native home for customer payment work. Individual workflows are added
 * here incrementally so their feature gates match the SPA from the outset.
 */
export function PosPaymentsScreen({
  allowHistory,
  allowReconciliation,
  allowReceive,
  currency,
  currencyPrecision,
  onBackToPos,
  paymentModes,
  posProfile,
}: PosPaymentsScreenProps) {
  const { connectionStatus } = useNetworkStatus();
  const { palette } = useAppearance();
  const availableTabs = useMemo(
    () =>
      tabDefinitions.filter(({ value }) =>
        value === "receive"
          ? allowReceive
          : value === "reconcile"
            ? allowReconciliation
            : allowHistory,
      ),
    [allowHistory, allowReconciliation, allowReceive],
  );
  const [selectedTab, setSelectedTab] = useState<PaymentWorkspaceTab>(
    availableTabs[0]?.value ?? "receive",
  );

  const activeTab = availableTabs.some(({ value }) => value === selectedTab)
    ? selectedTab
    : (availableTabs[0]?.value ?? "receive");

  const selectedTabLabel =
    availableTabs.find(({ value }) => value === activeTab)?.label ?? "Payments";

  if (!availableTabs.length) {
    return (
      <View
        accessibilityRole="alert"
        style={[styles.emptyState, { backgroundColor: palette.background }]}
      >
        <Text style={[styles.title, { color: palette.onSurface }]}>
          Payments disabled
        </Text>
        <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
          All customer payment operations are disabled for this POS Profile.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      style={{ backgroundColor: palette.background }}
    >
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Payments
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            Receive and reconcile customer payments.
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to POS"
          onPress={onBackToPos}
          style={[styles.backButton, { borderColor: palette.border }]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Back to POS
          </Text>
        </Pressable>
      </View>

      {connectionStatus === "offline" ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            {
              backgroundColor: palette.errorSurface,
              borderColor: palette.error,
            },
          ]}
        >
          <Text style={[styles.noticeText, { color: palette.onError }]}>
            Payments require a connection. Reconnect before continuing.
          </Text>
        </View>
      ) : null}

      <View
        accessibilityRole="tablist"
        style={[styles.tabs, { borderBottomColor: palette.border }]}
      >
        {availableTabs.map(({ label, value }) => {
          const active = value === activeTab;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={value}
              onPress={() => setSelectedTab(value)}
              style={[
                styles.tab,
                active && { borderBottomColor: palette.primary },
              ]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  { color: active ? palette.primary : palette.onSurfaceMuted },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "receive" ? (
        <ReceivePaymentContext
          currency={currency}
          currencyPrecision={currencyPrecision}
          paymentModes={paymentModes}
          posProfile={posProfile}
        />
      ) : activeTab === "reconcile" ? (
        <ReconcilePaymentContext
          currency={currency}
          currencyPrecision={currencyPrecision}
          posProfile={posProfile}
        />
      ) : (
        <View
          style={[
            styles.placeholder,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.placeholderTitle, { color: palette.onSurface }]}>
            {selectedTabLabel}
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            This workspace is ready. Its {selectedTabLabel.toLowerCase()}{" "}
            workflow will be added next.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ReceivePaymentContext({
  currency,
  currencyPrecision,
  paymentModes,
  posProfile,
}: {
  currency: string;
  currencyPrecision: number;
  paymentModes: PosPaymentMode[];
  posProfile?: string;
}) {
  const { connectionStatus } = useNetworkStatus();
  const { appearance, palette } = useAppearance();
  const isOffline = connectionStatus === "offline";
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<PosCustomerSearchResult | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const defaultMode =
    paymentModes.find((mode) => mode.default)?.mode_of_payment ||
    paymentModes[0]?.mode_of_payment ||
    "";
  const [mode, setMode] = useState(defaultMode);
  const [referenceNo, setReferenceNo] = useState("");
  const [referenceDate, setReferenceDate] = useState(today());
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [gatewayLink, setGatewayLink] = useState<PosGatewayPaymentLink | null>(
    null,
  );
  const [gatewayMethod, setGatewayMethod] = useState<"STK" | "C2B">("STK");
  const [gatewayPhone, setGatewayPhone] = useState("");
  const [c2bQuery, setC2bQuery] = useState("");
  const [c2bResults, setC2bResults] = useState<PosC2BGatewayPayment[]>([]);
  const [isC2bSearching, setIsC2bSearching] = useState(false);
  const [hasC2bSearched, setHasC2bSearched] = useState(false);
  const gatewayIdempotencyKey = useRef<string | null>(null);
  const customerSearch = usePosCustomerSearch(query, !isOffline);
  const customerDetails = usePosCustomerDetails({
    customer: selectedCustomer?.customer || "",
    posProfile,
  });
  const outstandingInvoices = (customerDetails.data?.invoices || []).filter(
    (invoice) => !invoice.is_return && invoice.outstanding_amount > 0,
  );
  const activeMode = paymentModes.some(
    (paymentMode) => paymentMode.mode_of_payment === mode,
  )
    ? mode
    : defaultMode;
  const selectedMode = paymentModes.find(
    (paymentMode) => paymentMode.mode_of_payment === activeMode,
  );
  const requiresReference = Boolean(selectedMode?.requires_reference);
  const isGatewayMode = Boolean(selectedMode?.payment_gateway);
  const hasInvalidAmount =
    Boolean(amount.trim()) &&
    (!Number.isFinite(Number(amount)) || Number(amount) <= 0);
  const receivePayment = useReceiveCustomerPayment();
  const gatewayPayment = useGatewayPayment();
  const hasRequiredReference =
    !requiresReference || Boolean(referenceNo.trim() && referenceDate);
  const isGatewayVerified = gatewayLink?.status === "Paid";
  const canSubmit = Boolean(
    !isOffline &&
    !receivePayment.isSubmitting &&
    selectedCustomer &&
    posProfile &&
    mode &&
    amount.trim() &&
    !hasInvalidAmount &&
    (!isGatewayMode || isGatewayVerified) &&
    hasRequiredReference,
  );

  const updateGatewayPaymentFromRealtime = useCallback(
    (nextGatewayLink: PosGatewayPaymentLink) => {
      setGatewayLink((current) =>
        current?.name === nextGatewayLink.name ? nextGatewayLink : current,
      );
    },
    [],
  );
  useGatewayPaymentRealtime(updateGatewayPaymentFromRealtime);

  useEffect(() => {
    if (
      !gatewayLink ||
      (gatewayLink.status !== "Draft" && gatewayLink.status !== "Pending")
    )
      return;
    const timeout = setTimeout(() => {
      void gatewayPayment
        .getStatus(gatewayLink.name)
        .then((nextGatewayLink) => {
          if (nextGatewayLink) setGatewayLink(nextGatewayLink);
        });
    }, 3000);
    return () => clearTimeout(timeout);
  }, [gatewayLink, gatewayPayment]);

  function selectCustomer(customer: PosCustomerSearchResult) {
    setSelectedCustomer(customer);
    setSelectedInvoice(null);
    setAmount("");
    setQuery("");
    setGatewayPhone(customer.mobile || "");
    clearGatewayState();
  }

  function selectInvoice(invoice: {
    name: string;
    outstanding_amount: number;
  }) {
    setSelectedInvoice(invoice.name);
    setAmount(String(invoice.outstanding_amount));
    clearGatewayState();
  }

  function selectAdvance() {
    setSelectedInvoice(null);
    setAmount("");
    clearGatewayState();
  }

  function changeMode(nextMode: string) {
    setMode(nextMode);
    setReferenceNo("");
    setReferenceDate(today());
    clearGatewayState();
  }

  function changeAmount(nextAmount: string) {
    setAmount(nextAmount);
    clearGatewayState();
  }

  function clearGatewayState() {
    setGatewayLink(null);
    setC2bQuery("");
    setC2bResults([]);
    setHasC2bSearched(false);
    gatewayIdempotencyKey.current = null;
  }

  function gatewayKey() {
    if (!selectedMode) return null;
    if (!gatewayIdempotencyKey.current) {
      gatewayIdempotencyKey.current = createGatewayIdempotencyKey(
        selectedMode.mode_of_payment,
      );
    }
    return gatewayIdempotencyKey.current;
  }

  async function initiateStkPayment() {
    const paymentAmount = Number(amount);
    const idempotencyKey = gatewayKey();
    if (
      !selectedCustomer ||
      !posProfile ||
      !selectedMode ||
      !idempotencyKey ||
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0 ||
      !gatewayPhone.trim()
    )
      return;
    const nextGatewayLink = await gatewayPayment.initiate({
      amount: paymentAmount,
      currency,
      customer: selectedCustomer.customer,
      idempotencyKey,
      modeOfPayment: selectedMode.mode_of_payment,
      phoneNumber: gatewayPhone.trim(),
      posProfile,
    });
    if (nextGatewayLink) setGatewayLink(nextGatewayLink);
  }

  async function refreshGatewayPayment() {
    if (!gatewayLink) return;
    const nextGatewayLink = await gatewayPayment.getStatus(gatewayLink.name);
    if (nextGatewayLink) setGatewayLink(nextGatewayLink);
  }

  async function cancelGatewayPayment() {
    if (!gatewayLink) return;
    const cancelledLink = await gatewayPayment.cancel(gatewayLink.name);
    if (cancelledLink) clearGatewayState();
  }

  async function searchC2BGatewayPayments() {
    if (
      !selectedCustomer ||
      !posProfile ||
      !selectedMode ||
      c2bQuery.trim().length < 3
    )
      return;
    setIsC2bSearching(true);
    setHasC2bSearched(true);
    const payments = await gatewayPayment.searchC2B({
      currency,
      customer: selectedCustomer.customer,
      modeOfPayment: selectedMode.mode_of_payment,
      posProfile,
      query: c2bQuery.trim(),
    });
    setC2bResults(payments || []);
    setIsC2bSearching(false);
  }

  async function attachC2BGatewayPayment(payment: PosC2BGatewayPayment) {
    const paymentAmount = Number(amount);
    const idempotencyKey = gatewayKey();
    if (
      !selectedCustomer ||
      !posProfile ||
      !selectedMode ||
      !idempotencyKey ||
      !Number.isFinite(paymentAmount) ||
      paymentAmount <= 0
    )
      return;
    const nextGatewayLink = await gatewayPayment.attachC2B({
      amount: paymentAmount,
      currency,
      customer: selectedCustomer.customer,
      idempotencyKey,
      modeOfPayment: selectedMode.mode_of_payment,
      posProfile,
      transactionReference: payment.transaction_id,
    });
    if (nextGatewayLink) setGatewayLink(nextGatewayLink);
  }

  async function submitPayment() {
    setValidationError(null);
    setSuccessMessage(null);
    const paymentAmount = Number(amount);
    if (!selectedCustomer || !posProfile) {
      setValidationError("Select a customer before receiving a payment.");
      return;
    }
    if (!mode) {
      setValidationError("Select a payment mode before receiving a payment.");
      return;
    }
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setValidationError("Enter an amount greater than zero.");
      return;
    }
    if (isGatewayMode && !isGatewayVerified) {
      setValidationError(
        "Collect and verify this gateway payment before submitting it.",
      );
      return;
    }
    if (!hasRequiredReference) {
      setValidationError(
        "Reference number and date are required for this payment mode.",
      );
      return;
    }

    const payment = await receivePayment.receive({
      amount: paymentAmount,
      customer: selectedCustomer.customer,
      gatewayPaymentLink: isGatewayMode ? gatewayLink?.name : undefined,
      invoice: selectedInvoice || undefined,
      modeOfPayment: mode,
      posProfile,
      referenceDate:
        !isGatewayMode && (requiresReference || referenceNo.trim())
          ? referenceDate
          : undefined,
      referenceNo: !isGatewayMode ? referenceNo.trim() || undefined : undefined,
      remarks: remarks.trim() || undefined,
    });
    if (!payment) return;

    setSuccessMessage(
      `Payment Entry ${payment.name} was submitted successfully.`,
    );
    setAmount("");
    setSelectedInvoice(null);
    setReferenceNo("");
    setReferenceDate(today());
    setRemarks("");
    clearGatewayState();
    customerDetails.reload();
  }

  return (
    <View
      style={[
        styles.receiveCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>
        Receive payment
      </Text>
      <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
        Choose the customer and where their payment should be applied.
      </Text>

      <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
        Customer
      </Text>
      {selectedCustomer ? (
        <View
          style={[
            styles.selectedCustomer,
            {
              backgroundColor: palette.surfaceContainer,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={styles.customerSummary}>
            <Text style={[styles.customerName, { color: palette.onSurface }]}>
              {selectedCustomer.customerName}
            </Text>
            <Text
              style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}
            >
              {selectedCustomer.mobile ||
                selectedCustomer.email ||
                selectedCustomer.customer}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Change payment customer"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={() => {
              setSelectedCustomer(null);
              setSelectedInvoice(null);
              setAmount("");
              clearGatewayState();
            }}
            style={[styles.textButton, { borderColor: palette.border }]}
          >
            <Text
              style={[styles.textButtonLabel, { color: palette.onSurface }]}
            >
              Change
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search payment customers"
            editable={!isOffline}
            onChangeText={setQuery}
            placeholder="Search customer, phone, or email"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
                color: palette.onSurface,
              },
            ]}
            value={query}
          />
          {customerSearch.isLoading ? (
            <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
              Searching customers…
            </Text>
          ) : null}
          {customerSearch.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              {customerSearch.error}
            </Text>
          ) : null}
          {!isOffline &&
          !customerSearch.isLoading &&
          !customerSearch.error &&
          customerSearch.rows.length ? (
            <View style={styles.searchResults}>
              {customerSearch.rows.map((customer) => (
                <Pressable
                  accessibilityLabel={`Select payment customer ${customer.customerName}`}
                  accessibilityRole="button"
                  key={customer.customer}
                  onPress={() => selectCustomer(customer)}
                  style={[
                    styles.customerResult,
                    { borderColor: palette.borderSubtle },
                  ]}
                >
                  <Text
                    style={[styles.customerName, { color: palette.onSurface }]}
                  >
                    {customer.customerName}
                  </Text>
                  <Text
                    style={[
                      styles.customerMeta,
                      { color: palette.onSurfaceMuted },
                    ]}
                  >
                    {customer.mobile || customer.email || customer.customer}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}

      {selectedCustomer ? (
        <>
          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
            Apply payment to
          </Text>
          {customerDetails.isLoading ? (
            <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
              Loading outstanding invoices…
            </Text>
          ) : null}
          {customerDetails.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              {customerDetails.error}
            </Text>
          ) : null}
          {!customerDetails.isLoading && !customerDetails.error ? (
            <View style={styles.invoiceOptions}>
              <Pressable
                accessibilityLabel="Apply as customer advance"
                accessibilityRole="button"
                onPress={selectAdvance}
                style={[
                  styles.invoiceOption,
                  {
                    backgroundColor:
                      selectedInvoice === null
                        ? palette.surfaceContainerHigh
                        : palette.surface,
                    borderColor:
                      selectedInvoice === null
                        ? palette.primary
                        : palette.border,
                  },
                ]}
              >
                <Text
                  style={[styles.invoiceTitle, { color: palette.onSurface }]}
                >
                  Customer advance
                </Text>
                <Text
                  style={[
                    styles.customerMeta,
                    { color: palette.onSurfaceMuted },
                  ]}
                >
                  Leave this payment unallocated.
                </Text>
              </Pressable>
              {outstandingInvoices.map((invoice) => {
                const active = selectedInvoice === invoice.name;
                const invoiceCurrency = invoice.currency || currency;
                return (
                  <Pressable
                    accessibilityLabel={`Apply payment to ${invoice.name}`}
                    accessibilityRole="button"
                    key={invoice.name}
                    onPress={() => selectInvoice(invoice)}
                    style={[
                      styles.invoiceOption,
                      {
                        backgroundColor: active
                          ? palette.surfaceContainerHigh
                          : palette.surface,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <View style={styles.invoiceRow}>
                      <Text
                        style={[
                          styles.invoiceTitle,
                          { color: palette.onSurface },
                        ]}
                      >
                        {invoice.name}
                      </Text>
                      <Text
                        style={[
                          styles.invoiceAmount,
                          { color: palette.onSurface },
                        ]}
                      >
                        {formatPosCurrency(
                          invoice.outstanding_amount,
                          invoiceCurrency,
                          currencyPrecision,
                        )}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.customerMeta,
                        { color: palette.onSurfaceMuted },
                      ]}
                    >
                      Outstanding balance
                    </Text>
                  </Pressable>
                );
              })}
              {!outstandingInvoices.length ? (
                <Text
                  style={[styles.stateText, { color: palette.onSurfaceMuted }]}
                >
                  No outstanding invoices for this customer.
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
            Amount
          </Text>
          <TextInput
            accessibilityLabel="Receive payment amount"
            inputMode="decimal"
            keyboardType="decimal-pad"
            onChangeText={changeAmount}
            placeholder="0.00"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
                color: palette.onSurface,
              },
            ]}
            value={amount}
          />
          {hasInvalidAmount ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              Enter an amount greater than zero.
            </Text>
          ) : null}

          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
            Payment mode
          </Text>
          {paymentModes.length ? (
            <View style={styles.paymentModeOptions}>
              {paymentModes.map((paymentMode) => {
                const active = paymentMode.mode_of_payment === activeMode;
                return (
                  <Pressable
                    accessibilityLabel={`Payment mode ${paymentMode.mode_of_payment}`}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    key={paymentMode.mode_of_payment}
                    onPress={() => changeMode(paymentMode.mode_of_payment)}
                    style={[
                      styles.paymentModeOption,
                      {
                        backgroundColor: active
                          ? palette.surfaceContainerHigh
                          : palette.surface,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.invoiceTitle,
                        { color: palette.onSurface },
                      ]}
                    >
                      {paymentMode.mode_of_payment}
                    </Text>
                    {paymentMode.default ? (
                      <Text
                        style={[
                          styles.customerMeta,
                          { color: palette.onSurfaceMuted },
                        ]}
                      >
                        Default
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              No payment mode is configured for this POS Profile.
            </Text>
          )}

          {!isGatewayMode ? (
            <>
              <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
                Reference number{requiresReference ? " *" : ""}
              </Text>
              <TextInput
                accessibilityLabel="Payment reference number"
                onChangeText={setReferenceNo}
                placeholder={
                  requiresReference
                    ? "Required for this payment mode"
                    : "Optional reference"
                }
                placeholderTextColor={palette.onSurfaceMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.surfaceContainer,
                    borderColor: palette.border,
                    color: palette.onSurface,
                  },
                ]}
                value={referenceNo}
              />
              {requiresReference || referenceNo ? (
                <>
                  <Text
                    style={[styles.fieldLabel, { color: palette.onSurface }]}
                  >
                    Reference date{requiresReference ? " *" : ""}
                  </Text>
                  <Pressable
                    accessibilityLabel="Choose payment reference date"
                    accessibilityRole="button"
                    onPress={() => setDatePickerVisible(true)}
                    style={[
                      styles.datePickerButton,
                      {
                        backgroundColor: palette.surfaceContainer,
                        borderColor: palette.border,
                      },
                    ]}
                  >
                    <MaterialCommunityIcons
                      color={palette.onSurfaceMuted}
                      name="calendar-month-outline"
                      size={20}
                    />
                    <Text
                      style={[
                        styles.datePickerButtonLabel,
                        { color: palette.onSurface },
                      ]}
                    >
                      {formatDate(referenceDate)}
                    </Text>
                  </Pressable>
                  {datePickerVisible ? (
                    <DateTimePicker
                      accentColor={palette.primary}
                      mode="date"
                      negativeButton={{ label: "Cancel" }}
                      onDismiss={() => setDatePickerVisible(false)}
                      onValueChange={(_event, selectedDate) => {
                        setReferenceDate(dateInputValue(selectedDate));
                        setDatePickerVisible(false);
                      }}
                      positiveButton={{ label: "Select" }}
                      presentation={
                        Platform.OS === "android" ? "dialog" : "inline"
                      }
                      themeVariant={appearance}
                      value={dateFromInput(referenceDate)}
                    />
                  ) : null}
                </>
              ) : null}
            </>
          ) : null}
          {isGatewayMode ? (
            <View
              style={[
                styles.gatewayPanel,
                {
                  backgroundColor: palette.surfaceContainer,
                  borderColor: palette.border,
                },
              ]}
            >
              <View style={styles.gatewayHeader}>
                <View style={styles.gatewayHeading}>
                  <Text
                    style={[styles.invoiceTitle, { color: palette.onSurface }]}
                  >
                    {selectedMode?.mode_of_payment} gateway payment
                  </Text>
                  <Text
                    style={[
                      styles.customerMeta,
                      { color: palette.onSurfaceMuted },
                    ]}
                  >
                    Verify this payment before submitting the Payment Entry.
                  </Text>
                </View>
                <Text
                  style={[
                    styles.gatewayStatus,
                    {
                      color: isGatewayVerified
                        ? palette.success
                        : palette.onSurfaceMuted,
                    },
                  ]}
                >
                  {isGatewayVerified
                    ? "Paid"
                    : gatewayLink
                      ? gatewayLink.status
                      : "Not started"}
                </Text>
              </View>
              <View style={styles.gatewayMethodOptions}>
                {(["STK", "C2B"] as const).map((method) => {
                  const active = gatewayMethod === method;
                  return (
                    <Pressable
                      accessibilityLabel={
                        method === "STK" ? "Use STK Push" : "Find C2B payment"
                      }
                      accessibilityRole="radio"
                      accessibilityState={{ selected: active }}
                      key={method}
                      onPress={() => {
                        gatewayPayment.clearError();
                        setGatewayMethod(method);
                      }}
                      style={[
                        styles.gatewayMethodOption,
                        {
                          backgroundColor: active
                            ? palette.surfaceContainerHigh
                            : palette.surface,
                          borderColor: active
                            ? palette.primary
                            : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.textButtonLabel,
                          { color: palette.onSurface },
                        ]}
                      >
                        {method === "STK" ? "STK Push" : "Find C2B payment"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {gatewayMethod === "STK" ? (
                <>
                  <Text
                    style={[styles.fieldLabel, { color: palette.onSurface }]}
                  >
                    Customer phone number
                  </Text>
                  <TextInput
                    accessibilityLabel="Gateway customer phone number"
                    inputMode="tel"
                    keyboardType="phone-pad"
                    onChangeText={setGatewayPhone}
                    placeholder="Phone number"
                    placeholderTextColor={palette.onSurfaceMuted}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.surface,
                        borderColor: palette.border,
                        color: palette.onSurface,
                      },
                    ]}
                    value={gatewayPhone}
                  />
                  <Pressable
                    accessibilityLabel="Send STK payment request"
                    accessibilityRole="button"
                    disabled={
                      gatewayPayment.isWorking ||
                      !gatewayPhone.trim() ||
                      hasInvalidAmount ||
                      !amount.trim() ||
                      isGatewayVerified
                    }
                    onPress={() => void initiateStkPayment()}
                    style={[
                      styles.gatewayActionButton,
                      {
                        backgroundColor: palette.primary,
                        opacity:
                          gatewayPayment.isWorking ||
                          !gatewayPhone.trim() ||
                          hasInvalidAmount ||
                          !amount.trim() ||
                          isGatewayVerified
                            ? 0.5
                            : 1,
                      },
                    ]}
                  >
                    {gatewayPayment.isWorking ? (
                      <ActivityIndicator
                        color={palette.onPrimary}
                        size="small"
                      />
                    ) : (
                      <Text
                        style={[
                          styles.submitButtonLabel,
                          { color: palette.onPrimary },
                        ]}
                      >
                        {gatewayLink ? "Retry STK request" : "Send STK request"}
                      </Text>
                    )}
                  </Pressable>
                </>
              ) : (
                <>
                  <Text
                    style={[styles.fieldLabel, { color: palette.onSurface }]}
                  >
                    Transaction reference or payer
                  </Text>
                  <View style={styles.c2bSearchRow}>
                    <TextInput
                      accessibilityLabel="Search C2B payments"
                      autoCapitalize="characters"
                      onChangeText={(nextQuery) => {
                        setC2bQuery(nextQuery);
                        setHasC2bSearched(false);
                      }}
                      placeholder="Search incoming payment"
                      placeholderTextColor={palette.onSurfaceMuted}
                      style={[
                        styles.input,
                        styles.c2bSearchInput,
                        {
                          backgroundColor: palette.surface,
                          borderColor: palette.border,
                          color: palette.onSurface,
                        },
                      ]}
                      value={c2bQuery}
                    />
                    <Pressable
                      accessibilityLabel="Search incoming C2B payments"
                      accessibilityRole="button"
                      disabled={
                        isC2bSearching ||
                        gatewayPayment.isWorking ||
                        c2bQuery.trim().length < 3
                      }
                      onPress={() => void searchC2BGatewayPayments()}
                      style={[
                        styles.textButton,
                        {
                          borderColor: palette.border,
                          opacity:
                            isC2bSearching ||
                            gatewayPayment.isWorking ||
                            c2bQuery.trim().length < 3
                              ? 0.5
                              : 1,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.textButtonLabel,
                          { color: palette.onSurface },
                        ]}
                      >
                        {isC2bSearching ? "Searching…" : "Search"}
                      </Text>
                    </Pressable>
                  </View>
                  {c2bResults.map((payment) => {
                    const amountMatches =
                      parsePaymentAmount(amount, currencyPrecision) ===
                      totalToMinorUnits(payment.amount, currencyPrecision);
                    return (
                      <Pressable
                        accessibilityLabel={`Attach C2B payment ${payment.transaction_id}`}
                        accessibilityRole="button"
                        disabled={
                          gatewayPayment.isWorking ||
                          !amountMatches ||
                          isGatewayVerified
                        }
                        key={payment.name}
                        onPress={() => void attachC2BGatewayPayment(payment)}
                        style={[
                          styles.c2bPayment,
                          {
                            backgroundColor: palette.surface,
                            borderColor: palette.border,
                            opacity:
                              gatewayPayment.isWorking ||
                              !amountMatches ||
                              isGatewayVerified
                                ? 0.5
                                : 1,
                          },
                        ]}
                      >
                        <View style={styles.gatewayHeading}>
                          <Text
                            style={[
                              styles.invoiceTitle,
                              { color: palette.onSurface },
                            ]}
                          >
                            {payment.party_name ||
                              payment.party_phone ||
                              "Incoming payment"}
                          </Text>
                          <Text
                            style={[
                              styles.customerMeta,
                              { color: palette.onSurfaceMuted },
                            ]}
                          >
                            {payment.transaction_id}
                          </Text>
                        </View>
                        <View style={styles.c2bAmount}>
                          <Text
                            style={[
                              styles.invoiceAmount,
                              { color: palette.onSurface },
                            ]}
                          >
                            {formatPosCurrency(
                              payment.amount,
                              payment.currency || currency,
                              currencyPrecision,
                            )}
                          </Text>
                          {!amountMatches ? (
                            <Text
                              style={[
                                styles.errorText,
                                { color: palette.error },
                              ]}
                            >
                              Amount does not match
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                  {hasC2bSearched && !isC2bSearching && !c2bResults.length ? (
                    <Text
                      style={[
                        styles.stateText,
                        { color: palette.onSurfaceMuted },
                      ]}
                    >
                      No verified incoming payments found.
                    </Text>
                  ) : null}
                </>
              )}
              {gatewayPayment.error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.errorText, { color: palette.error }]}
                >
                  {gatewayPayment.error}
                </Text>
              ) : null}
              {gatewayLink ? (
                <View style={styles.gatewayActions}>
                  <Pressable
                    accessibilityLabel="Check gateway payment status"
                    accessibilityRole="button"
                    disabled={gatewayPayment.isWorking}
                    onPress={() => void refreshGatewayPayment()}
                    style={[styles.textButton, { borderColor: palette.border }]}
                  >
                    <Text
                      style={[
                        styles.textButtonLabel,
                        { color: palette.onSurface },
                      ]}
                    >
                      Check status
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="Cancel gateway payment"
                    accessibilityRole="button"
                    disabled={gatewayPayment.isWorking || isGatewayVerified}
                    onPress={() => void cancelGatewayPayment()}
                    style={[styles.textButton, { borderColor: palette.border }]}
                  >
                    <Text
                      style={[
                        styles.textButtonLabel,
                        { color: palette.onSurface },
                      ]}
                    >
                      Cancel payment
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
            Remarks
          </Text>
          <TextInput
            accessibilityLabel="Payment remarks"
            multiline
            onChangeText={setRemarks}
            placeholder="Optional payment note"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[
              styles.remarksInput,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
                color: palette.onSurface,
              },
            ]}
            value={remarks}
          />
          {validationError || receivePayment.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              {validationError || receivePayment.error}
            </Text>
          ) : null}
          {successMessage ? (
            <Text
              accessibilityRole="alert"
              style={[styles.successText, { color: palette.success }]}
            >
              {successMessage}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel="Submit customer payment"
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            disabled={!canSubmit}
            onPress={() => void submitPayment()}
            style={[
              styles.submitButton,
              {
                backgroundColor: palette.primary,
                opacity: canSubmit ? 1 : 0.5,
              },
            ]}
          >
            <Text
              style={[styles.submitButtonLabel, { color: palette.onPrimary }]}
            >
              {receivePayment.isSubmitting
                ? "Receiving payment…"
                : selectedInvoice
                  ? "Receive and allocate payment"
                  : "Receive customer advance"}
            </Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

/**
 * The first reconciliation increment deliberately stops at the authoritative
 * candidate list. Selecting entries and committing allocations comes next.
 */
function ReconcilePaymentContext({
  currency,
  currencyPrecision,
  posProfile,
}: {
  currency: string;
  currencyPrecision: number;
  posProfile?: string;
}) {
  const { connectionStatus } = useNetworkStatus();
  const { palette } = useAppearance();
  const isOffline = connectionStatus === "offline";
  const [query, setQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] =
    useState<PosCustomerSearchResult | null>(null);
  const [selectedPayments, setSelectedPayments] = useState<string[]>([]);
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([]);
  const [allocationPreview, setAllocationPreview] = useState<
    PosPaymentReconciliationAllocation[]
  >([]);
  const customerSearch = usePosCustomerSearch(query, !isOffline);
  const allocation = usePosPaymentReconciliationAllocation();
  const candidates = usePosPaymentReconciliationCandidates(
    selectedCustomer?.customer || "",
    posProfile,
  );

  function resetSelections() {
    setSelectedPayments([]);
    setSelectedInvoices([]);
    setAllocationPreview([]);
    allocation.clearError();
  }

  function selectCustomer(customer: PosCustomerSearchResult) {
    setSelectedCustomer(customer);
    setQuery("");
    resetSelections();
  }

  function changeCustomer() {
    setSelectedCustomer(null);
    resetSelections();
  }

  function togglePayment(name: string) {
    setAllocationPreview([]);
    allocation.clearError();
    setSelectedPayments((current) =>
      current.includes(name)
        ? current.filter((payment) => payment !== name)
        : [...current, name],
    );
  }

  function toggleInvoice(name: string) {
    setAllocationPreview([]);
    allocation.clearError();
    setSelectedInvoices((current) =>
      current.includes(name)
        ? current.filter((invoice) => invoice !== name)
        : [...current, name],
    );
  }

  const canAllocate = Boolean(
    !isOffline &&
    !allocation.isAllocating &&
    posProfile &&
    selectedCustomer &&
    selectedPayments.length &&
    selectedInvoices.length,
  );

  async function requestAllocationPreview() {
    if (!selectedCustomer || !posProfile) return;
    const preview = await allocation.allocate({
      customer: selectedCustomer.customer,
      invoices: selectedInvoices,
      paymentEntries: selectedPayments,
      posProfile,
    });
    if (preview) setAllocationPreview(preview);
  }

  return (
    <View
      style={[
        styles.receiveCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>
        Reconcile payments
      </Text>
      <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
        Match a customer’s available payments with their outstanding invoices.
      </Text>

      <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>
        Customer
      </Text>
      {selectedCustomer ? (
        <View
          style={[
            styles.selectedCustomer,
            {
              backgroundColor: palette.surfaceContainer,
              borderColor: palette.border,
            },
          ]}
        >
          <View style={styles.customerSummary}>
            <Text style={[styles.customerName, { color: palette.onSurface }]}>
              {selectedCustomer.customerName}
            </Text>
            <Text
              style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}
            >
              {selectedCustomer.mobile ||
                selectedCustomer.email ||
                selectedCustomer.customer}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Change reconciliation customer"
            accessibilityRole="button"
            disabled={isOffline}
            onPress={changeCustomer}
            style={[styles.textButton, { borderColor: palette.border }]}
          >
            <Text
              style={[styles.textButtonLabel, { color: palette.onSurface }]}
            >
              Change
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Search reconciliation customers"
            editable={!isOffline}
            onChangeText={setQuery}
            placeholder="Search customer, phone, or email"
            placeholderTextColor={palette.onSurfaceMuted}
            style={[
              styles.input,
              {
                backgroundColor: palette.surfaceContainer,
                borderColor: palette.border,
                color: palette.onSurface,
              },
            ]}
            value={query}
          />
          {customerSearch.isLoading ? (
            <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
              Searching customers…
            </Text>
          ) : null}
          {customerSearch.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              {customerSearch.error}
            </Text>
          ) : null}
          {!isOffline &&
          !customerSearch.isLoading &&
          !customerSearch.error &&
          customerSearch.rows.length ? (
            <View style={styles.searchResults}>
              {customerSearch.rows.map((customer) => (
                <Pressable
                  accessibilityLabel={`Select reconciliation customer ${customer.customerName}`}
                  accessibilityRole="button"
                  key={customer.customer}
                  onPress={() => selectCustomer(customer)}
                  style={[
                    styles.customerResult,
                    { borderColor: palette.borderSubtle },
                  ]}
                >
                  <Text
                    style={[styles.customerName, { color: palette.onSurface }]}
                  >
                    {customer.customerName}
                  </Text>
                  <Text
                    style={[
                      styles.customerMeta,
                      { color: palette.onSurfaceMuted },
                    ]}
                  >
                    {customer.mobile || customer.email || customer.customer}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )}

      {selectedCustomer ? (
        <>
          {candidates.isLoading ? (
            <View style={styles.reconciliationLoading}>
              <ActivityIndicator color={palette.primary} size="small" />
              <Text
                style={[styles.stateText, { color: palette.onSurfaceMuted }]}
              >
                Loading reconciliation candidates…
              </Text>
            </View>
          ) : null}
          {candidates.error ? (
            <Text
              accessibilityRole="alert"
              style={[styles.errorText, { color: palette.error }]}
            >
              {candidates.error}
            </Text>
          ) : null}
          {!candidates.isLoading && !candidates.error ? (
            <View style={styles.reconciliationLists}>
              <ReconciliationCandidateList
                candidates={candidates.data?.payments || []}
                currency={currency}
                currencyPrecision={currencyPrecision}
                emptyMessage="No unallocated payments for this customer."
                onToggle={togglePayment}
                selectedNames={selectedPayments}
                title="Unallocated payments"
              />
              <ReconciliationCandidateList
                candidates={candidates.data?.invoices || []}
                currency={currency}
                currencyPrecision={currencyPrecision}
                emptyMessage="No outstanding invoices for this customer."
                onToggle={toggleInvoice}
                outstanding
                selectedNames={selectedInvoices}
                title="Outstanding invoices"
              />
            </View>
          ) : null}
          {!candidates.isLoading && !candidates.error ? (
            <>
              {allocation.error ? (
                <Text
                  accessibilityRole="alert"
                  style={[styles.errorText, { color: palette.error }]}
                >
                  {allocation.error}
                </Text>
              ) : null}
              <Pressable
                accessibilityLabel="Preview payment allocation"
                accessibilityRole="button"
                accessibilityState={{ disabled: !canAllocate }}
                disabled={!canAllocate}
                onPress={() => void requestAllocationPreview()}
                style={[
                  styles.allocateButton,
                  {
                    backgroundColor: palette.primary,
                    opacity: canAllocate ? 1 : 0.5,
                  },
                ]}
              >
                {allocation.isAllocating ? (
                  <ActivityIndicator color={palette.onPrimary} size="small" />
                ) : (
                  <Text
                    style={[
                      styles.submitButtonLabel,
                      { color: palette.onPrimary },
                    ]}
                  >
                    Allocate
                  </Text>
                )}
              </Pressable>
              {allocationPreview.length ? (
                <AllocationPreview
                  allocations={allocationPreview}
                  currency={currency}
                  currencyPrecision={currencyPrecision}
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function AllocationPreview({
  allocations,
  currency,
  currencyPrecision,
}: {
  allocations: PosPaymentReconciliationAllocation[];
  currency: string;
  currencyPrecision: number;
}) {
  const { palette } = useAppearance();

  return (
    <View
      style={[
        styles.allocationPreview,
        {
          backgroundColor: palette.surfaceContainer,
          borderColor: palette.border,
        },
      ]}
    >
      <Text
        style={[styles.reconciliationListTitle, { color: palette.onSurface }]}
      >
        Allocation preview
      </Text>
      {allocations.map((allocation, index) => (
        <View
          key={`${allocation.payment_entry}-${allocation.invoice}-${index}`}
          style={[
            styles.allocationPreviewRow,
            { borderColor: palette.borderSubtle },
          ]}
        >
          <Text style={[styles.invoiceTitle, { color: palette.onSurface }]}>
            {allocation.payment_entry}
          </Text>
          <Text
            style={[
              styles.allocationPreviewAmount,
              { color: palette.onSurface },
            ]}
          >
            {formatPosCurrency(
              allocation.allocated_amount,
              allocation.currency || currency,
              currencyPrecision,
            )}{" "}
            {"→"}
          </Text>
          <Text style={[styles.invoiceTitle, { color: palette.onSurface }]}>
            {allocation.invoice}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ReconciliationCandidateList({
  candidates,
  currency,
  currencyPrecision,
  emptyMessage,
  onToggle,
  outstanding = false,
  selectedNames,
  title,
}: {
  candidates: PosPaymentReconciliationCandidate[];
  currency: string;
  currencyPrecision: number;
  emptyMessage: string;
  onToggle: (name: string) => void;
  outstanding?: boolean;
  selectedNames: string[];
  title: string;
}) {
  const { palette } = useAppearance();

  return (
    <View
      style={[
        styles.reconciliationList,
        {
          backgroundColor: palette.surfaceContainer,
          borderColor: palette.border,
        },
      ]}
    >
      <Text
        style={[styles.reconciliationListTitle, { color: palette.onSurface }]}
      >
        {title}
      </Text>
      {candidates.length ? (
        candidates.map((candidate) => {
          const selected = selectedNames.includes(candidate.name);
          const amount = outstanding
            ? candidate.outstanding_amount || 0
            : candidate.amount;
          return (
            <Pressable
              accessibilityLabel={`Select ${outstanding ? "invoice" : "payment"} ${candidate.name}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={candidate.name}
              onPress={() => onToggle(candidate.name)}
              style={[
                styles.reconciliationRow,
                {
                  backgroundColor: selected
                    ? palette.surfaceContainerHigh
                    : undefined,
                  borderColor: selected
                    ? palette.primary
                    : palette.borderSubtle,
                },
              ]}
            >
              <MaterialCommunityIcons
                color={selected ? palette.primary : palette.onSurfaceMuted}
                name={selected ? "checkbox-marked" : "checkbox-blank-outline"}
                size={22}
              />
              <View style={styles.reconciliationRowDetails}>
                <Text
                  style={[styles.invoiceTitle, { color: palette.onSurface }]}
                >
                  {candidate.name}
                </Text>
                <Text
                  style={[
                    styles.customerMeta,
                    { color: palette.onSurfaceMuted },
                  ]}
                >
                  {formatDate(candidate.posting_date)}
                </Text>
              </View>
              <Text
                style={[styles.invoiceAmount, { color: palette.onSurface }]}
              >
                {formatPosCurrency(
                  amount,
                  candidate.currency || currency,
                  currencyPrecision,
                )}
              </Text>
            </Pressable>
          );
        })
      ) : (
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          {emptyMessage}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  allocateButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  allocationPreview: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  allocationPreviewAmount: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    textAlign: "center",
  },
  allocationPreviewRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingTop: spacing.sm,
  },
  content: { flexGrow: 1, gap: spacing.lg, padding: spacing.md },
  customerMeta: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  customerName: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.compact,
  },
  customerResult: {
    borderBottomWidth: 1,
    gap: 2,
    paddingVertical: spacing.sm,
  },
  customerSummary: { flex: 1, gap: 2 },
  c2bAmount: { alignItems: "flex-end", gap: 2 },
  c2bPayment: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  c2bSearchInput: { flex: 1 },
  c2bSearchRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  datePickerButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  datePickerButtonLabel: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
  },
  description: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    lineHeight: typography.lineHeight.body,
  },
  emptyState: {
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
    padding: spacing.xl,
  },
  errorText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  backButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 36,
    paddingHorizontal: spacing.sm,
  },
  backButtonLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  header: { flex: 1, gap: 2 },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  fieldLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    marginTop: spacing.xs,
  },
  gatewayActionButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  gatewayActions: { flexDirection: "row", gap: spacing.sm },
  gatewayHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  gatewayHeading: { flex: 1, gap: 2 },
  gatewayMethodOption: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  gatewayMethodOptions: { flexDirection: "row", gap: spacing.sm },
  gatewayPanel: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  gatewayStatus: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    minHeight: 46,
    paddingHorizontal: spacing.sm,
  },
  invoiceAmount: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  invoiceOption: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 2,
    padding: spacing.sm,
  },
  invoiceOptions: { gap: spacing.sm },
  invoiceRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  invoiceTitle: {
    flex: 1,
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  notice: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  noticeText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  paymentModeOption: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 2,
    minWidth: 108,
    padding: spacing.sm,
  },
  paymentModeOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  placeholder: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  placeholderTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 18,
  },
  receiveCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  reconciliationList: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  reconciliationListTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  reconciliationLists: { gap: spacing.sm },
  reconciliationLoading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  reconciliationRow: {
    alignItems: "center",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    paddingTop: spacing.sm,
  },
  reconciliationRowDetails: { flex: 1, gap: 2 },
  remarksInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    minHeight: 88,
    padding: spacing.sm,
    textAlignVertical: "top",
  },
  searchResults: { gap: 0 },
  sectionTitle: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: 18,
  },
  selectedCustomer: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
  submitButton: {
    alignItems: "center",
    borderRadius: radii.md,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.md,
  },
  submitButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.body,
  },
  successText: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  tab: {
    borderBottomWidth: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tabLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  tabs: { flexDirection: "row", borderBottomWidth: 1 },
  textButton: {
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  textButtonLabel: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
  },
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
    lineHeight: typography.lineHeight.heading,
  },
});
