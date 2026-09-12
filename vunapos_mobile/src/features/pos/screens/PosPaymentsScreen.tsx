import { useMemo, useState } from "react";
import {
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
import { PosCustomerSearchResult } from "@/features/pos/types";
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
  posProfile?: string;
};

const tabDefinitions: { label: string; value: PaymentWorkspaceTab }[] = [
  { label: "Receive", value: "receive" },
  { label: "Reconcile", value: "reconcile" },
  { label: "History", value: "history" },
];

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
    availableTabs.find(({ value }) => value === activeTab)?.label ??
    "Payments";

  if (!availableTabs.length) {
    return (
      <View
        accessibilityRole="alert"
        style={[styles.emptyState, { backgroundColor: palette.background }]}
      >
        <Text style={[styles.title, { color: palette.onSurface }]}>Payments disabled</Text>
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
          <Text style={[styles.title, { color: palette.onSurface }]}>Payments</Text>
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
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>Back to POS</Text>
        </Pressable>
      </View>

      {connectionStatus === "offline" ? (
        <View
          accessibilityRole="alert"
          style={[
            styles.notice,
            { backgroundColor: palette.errorSurface, borderColor: palette.error },
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
            This workspace is ready. Its {selectedTabLabel.toLowerCase()} workflow
            will be added next.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function ReceivePaymentContext({
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
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const customerSearch = usePosCustomerSearch(query, !isOffline);
  const customerDetails = usePosCustomerDetails({
    customer: selectedCustomer?.customer || "",
    posProfile,
  });
  const outstandingInvoices = (customerDetails.data?.invoices || []).filter(
    (invoice) => !invoice.is_return && invoice.outstanding_amount > 0,
  );

  function selectCustomer(customer: PosCustomerSearchResult) {
    setSelectedCustomer(customer);
    setSelectedInvoice(null);
    setAmount("");
    setQuery("");
  }

  function selectInvoice(invoice: { name: string; outstanding_amount: number }) {
    setSelectedInvoice(invoice.name);
    setAmount(String(invoice.outstanding_amount));
  }

  function selectAdvance() {
    setSelectedInvoice(null);
    setAmount("");
  }

  return (
    <View
      style={[
        styles.receiveCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.sectionTitle, { color: palette.onSurface }]}>Receive payment</Text>
      <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
        Choose the customer and where their payment should be applied.
      </Text>

      <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>Customer</Text>
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
            <Text style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}>
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
            }}
            style={[styles.textButton, { borderColor: palette.border }]}
          >
            <Text style={[styles.textButtonLabel, { color: palette.onSurface }]}>Change</Text>
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
            <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
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
                  <Text style={[styles.customerName, { color: palette.onSurface }]}>
                    {customer.customerName}
                  </Text>
                  <Text style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}>
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
          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>Apply payment to</Text>
          {customerDetails.isLoading ? (
            <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
              Loading outstanding invoices…
            </Text>
          ) : null}
          {customerDetails.error ? (
            <Text accessibilityRole="alert" style={[styles.errorText, { color: palette.error }]}>
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
                      selectedInvoice === null ? palette.primary : palette.border,
                  },
                ]}
              >
                <Text style={[styles.invoiceTitle, { color: palette.onSurface }]}>Customer advance</Text>
                <Text style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}>
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
                      <Text style={[styles.invoiceTitle, { color: palette.onSurface }]}>
                        {invoice.name}
                      </Text>
                      <Text style={[styles.invoiceAmount, { color: palette.onSurface }]}>
                        {formatPosCurrency(
                          invoice.outstanding_amount,
                          invoiceCurrency,
                          currencyPrecision,
                        )}
                      </Text>
                    </View>
                    <Text style={[styles.customerMeta, { color: palette.onSurfaceMuted }]}>
                      Outstanding balance
                    </Text>
                  </Pressable>
                );
              })}
              {!outstandingInvoices.length ? (
                <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
                  No outstanding invoices for this customer.
                </Text>
              ) : null}
            </View>
          ) : null}

          <Text style={[styles.fieldLabel, { color: palette.onSurface }]}>Amount</Text>
          <TextInput
            accessibilityLabel="Receive payment amount"
            inputMode="decimal"
            keyboardType="decimal-pad"
            onChangeText={setAmount}
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
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
