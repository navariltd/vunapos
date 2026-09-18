import { useCallback, useMemo, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "react-native-paper";

import { PosCacheStatus } from "@/features/pos/components/PosCacheStatus";
import { PosInvoiceFiltersSheet } from "@/features/pos/components/PosInvoiceFiltersSheet";
import { PosInvoiceListItem } from "@/features/pos/components/PosInvoiceListItem";
import { formatPosCurrency } from "@/features/pos/currency";
import { usePosBootstrap } from "@/features/pos/hooks/usePosBootstrap";
import { usePosHeldInvoices } from "@/features/pos/hooks/usePosHeldInvoices";
import { usePosInvoiceHistory } from "@/features/pos/hooks/usePosInvoiceHistory";
import {
  PosHeldInvoice,
  PosInvoiceHistoryFilters,
  PosInvoiceHistoryRow,
  PosInvoiceListRow,
} from "@/features/pos/types";
import { useAppearance } from "@/theme/AppearanceProvider";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { AppPalette, radii, spacing, typography } from "@/theme/tokens";

const initialFilters: PosInvoiceHistoryFilters = {
  currentShift: true,
  customer: "",
  documentType: "Invoice",
  fromDate: "",
  invoice: "",
  paymentMode: "",
  saleType: "",
  status: "",
  toDate: "",
};

function formatPostedAt(row: PosInvoiceHistoryRow) {
  const date = row.posting_date
    ? row.posting_date.split("-").reverse().join("/")
    : "-";
  const time = row.posting_time?.split(".")[0]?.slice(0, 5);
  return time ? `${date} · ${time}` : date;
}

function toListRow(row: PosInvoiceHistoryRow): PosInvoiceListRow {
  return {
    cashier: row.vunapos_session_cashier,
    creditSale: Boolean(row.vunapos_credit_sale),
    currency: row.currency,
    customerId: row.customer,
    customerName: row.customer_name || row.customer || "No customer",
    doctype: row.doctype,
    dueDate: row.due_date,
    invoiceNumber: row.name,
    itemCount: row.total_qty,
    openingEntry: row.vunapos_opening_entry,
    outstandingAmount: row.outstanding_amount,
    payments: row.payments,
    paymentMode: row.payments.length
      ? row.payments.map((payment) => payment.mode_of_payment).join(" · ")
      : row.vunapos_credit_sale
        ? "No deposit"
        : "No payment rows",
    postedAt: formatPostedAt(row),
    status: row.status,
    total: row.rounded_total || row.grand_total,
  };
}

type DocumentTabProps = {
  active: boolean;
  label: string;
  onPress: () => void;
};

function DocumentTab({ active, label, onPress }: DocumentTabProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.documentTab, active && styles.documentTabActive]}
    >
      <Text
        style={[
          styles.documentTabLabel,
          { color: active ? palette.primary : palette.onSurfaceMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type SummaryCardProps = {
  label: string;
  value: string;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  const { palette } = useAppearance();
  const styles = createStyles(palette);
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.summaryValue}>
        {value}
      </Text>
    </View>
  );
}

type PosInvoicesScreenProps = {
  heldRefreshKey?: number;
  onBackToPos: () => void;
  onOpenInvoice: (invoice: { doctype?: string; name: string }) => void;
  onRestoreHeld: (invoice: PosHeldInvoice) => Promise<void>;
};

function formatModified(value?: string | null) {
  if (!value) return "Modified recently";
  const date = new Date(value.replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

export function PosInvoicesScreen({
  heldRefreshKey = 0,
  onBackToPos,
  onOpenInvoice,
  onRestoreHeld,
}: PosInvoicesScreenProps) {
  const { palette } = useAppearance();
  const { connectionStatus } = useNetworkStatus();
  const styles = createStyles(palette);
  const [activeTab, setActiveTab] = useState<"history" | "held">("history");
  const [filters, setFilters] =
    useState<PosInvoiceHistoryFilters>(initialFilters);
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const [draftFilters, setDraftFilters] =
    useState<PosInvoiceHistoryFilters>(initialFilters);
  const [start, setStart] = useState(0);
  const bootstrap = usePosBootstrap();
  const history = usePosInvoiceHistory({
    filters,
    posProfile: bootstrap.data?.pos_profile.name,
    start,
  });
  const held = usePosHeldInvoices({
    enabled: activeTab === "held",
    posProfile: bootstrap.data?.pos_profile.name,
    refreshKey: heldRefreshKey,
  });
  const currency = bootstrap.data?.pos_profile.currency ?? "KES";
  const currencyPrecision = bootstrap.data?.pos_profile.currency_precision ?? 2;
  const formatCurrency = (amount: number, amountCurrency = currency) =>
    formatPosCurrency(amount, amountCurrency, currencyPrecision);
  const invoiceRows = useMemo(
    () => history.data?.invoices.map(toListRow) ?? [],
    [history.data],
  );
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoringName, setRestoringName] = useState<string | null>(null);
  const isOffline = connectionStatus !== "online";
  const reloadHeld = held.reload;
  const reloadHistory = history.reload;
  const refreshActiveTab = useCallback(async () => {
    if (activeTab === "held") await reloadHeld();
    else await reloadHistory();
  }, [activeTab, reloadHeld, reloadHistory]);

  function updateFilter<Key extends keyof PosInvoiceHistoryFilters>(
    field: Key,
    value: PosInvoiceHistoryFilters[Key],
  ) {
    setFilters((current) => ({ ...current, [field]: value }));
    setStart(0);
  }

  function updateDraftFilter<Key extends keyof PosInvoiceHistoryFilters>(
    field: Key,
    value: PosInvoiceHistoryFilters[Key],
  ) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  function openFilterSheet() {
    setDraftFilters(filters);
    setFilterSheetVisible(true);
  }

  function applyFilters() {
    setFilters(draftFilters);
    setStart(0);
    setFilterSheetVisible(false);
  }

  function clearDraftFilters() {
    setDraftFilters({
      ...initialFilters,
      documentType: draftFilters.documentType,
    });
  }

  async function restoreHeld(invoice: PosHeldInvoice) {
    setRestoreError(null);
    setRestoringName(invoice.name);
    try {
      await onRestoreHeld(invoice);
    } catch (error) {
      setRestoreError(
        error instanceof Error
          ? error.message
          : "Could not restore this held invoice.",
      );
    } finally {
      setRestoringName(null);
    }
  }

  const historyError = bootstrap.error ?? history.error;
  const activeFilterCount = [
    filters.customer,
    filters.fromDate,
    filters.invoice,
    filters.paymentMode,
    filters.saleType,
    filters.status,
    filters.toDate,
    filters.currentShift ? "" : "currentShift",
  ].filter(Boolean).length;

  const tabs = (
    <View accessibilityRole="tablist" style={styles.documentTabs}>
      <DocumentTab
        active={activeTab === "history" && filters.documentType === "Invoice"}
        label="Sales history"
        onPress={() => {
          setActiveTab("history");
          updateFilter("documentType", "Invoice");
        }}
      />
      <DocumentTab
        active={activeTab === "history" && filters.documentType === "Order"}
        label="Sales orders"
        onPress={() => {
          setActiveTab("history");
          updateFilter("documentType", "Order");
        }}
      />
      <DocumentTab
        active={
          activeTab === "history" && filters.documentType === "Draft Order"
        }
        label="Draft orders"
        onPress={() => {
          setActiveTab("history");
          updateFilter("documentType", "Draft Order");
        }}
      />
      <DocumentTab
        active={activeTab === "held"}
        label="Held invoices"
        onPress={() => setActiveTab("held")}
      />
    </View>
  );

  if (activeTab === "held") {
    const heldError = bootstrap.error ?? held.error ?? restoreError;
    return (
      <FlatList
        contentContainerStyle={styles.content}
        data={held.data ?? []}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(invoice) => `${invoice.doctype}-${invoice.name}`}
        ListEmptyComponent={
          bootstrap.isLoading || held.isLoading ? (
            <Text style={styles.emptyState}>
              {bootstrap.isLoading
                ? "Loading POS workspace…"
                : "Loading held invoices…"}
            </Text>
          ) : heldError ? null : (
            <Text style={styles.emptyState}>
              No invoices are currently held.
            </Text>
          )
        }
        ListFooterComponent={
          <PosCacheStatus
            isOffline={isOffline}
            isRefreshing={held.isRefreshing}
            isStale={held.isStale}
            lastUpdated={held.lastUpdated}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.heading}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Invoices</Text>
                <Pressable
                  accessibilityLabel="Back to POS"
                  onPress={onBackToPos}
                  style={styles.backToPosButton}
                >
                  <Text style={styles.backToPosButtonLabel}>Back to POS</Text>
                </Pressable>
              </View>
              <Text style={styles.subtitle}>
                Resume an online invoice without creating another draft.
              </Text>
            </View>
            {tabs}
            <View style={styles.heldSummaryRow}>
              <Text style={styles.filterSummary}>
                {held.data?.length
                  ? `${held.data.length} waiting`
                  : "No held invoices"}
              </Text>
              <Pressable
                accessibilityLabel="Refresh held invoices"
                disabled={Boolean(held.isLoading || held.isRefreshing)}
                onPress={() => void held.reload()}
                style={[
                  styles.filtersButton,
                  (held.isLoading || held.isRefreshing) &&
                    styles.paginationButtonDisabled,
                ]}
              >
                <Text style={styles.filtersButtonLabel}>
                  {held.isLoading || held.isRefreshing
                    ? "Refreshing…"
                    : "Refresh"}
                </Text>
              </Pressable>
            </View>
            {heldError ? (
              <View style={styles.errorNotice}>
                <Text style={styles.errorText}>{heldError}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.heldInvoiceCard}>
            <View style={styles.heldInvoiceMain}>
              <Text numberOfLines={1} style={styles.heldInvoiceName}>
                {item.name}
              </Text>
              <Text numberOfLines={1} style={styles.heldInvoiceCustomer}>
                {item.customer_name || item.customer || "No customer"}
              </Text>
              <Text style={styles.heldInvoiceModified}>
                {formatModified(item.modified)}
              </Text>
            </View>
            <View style={styles.heldInvoiceAside}>
              <Text style={styles.heldInvoiceTotal}>
                {formatCurrency(
                  Number(
                    item.total ?? item.rounded_total ?? item.grand_total ?? 0,
                  ),
                  item.currency || currency,
                )}
              </Text>
              <Pressable
                accessibilityLabel={`Restore ${item.name}`}
                disabled={Boolean(restoringName)}
                onPress={() => void restoreHeld(item)}
                style={[
                  styles.restoreButton,
                  restoringName && styles.paginationButtonDisabled,
                ]}
              >
                <Text style={styles.restoreButtonLabel}>
                  {restoringName === item.name ? "Restoring…" : "Continue"}
                </Text>
              </Pressable>
            </View>
          </View>
        )}
        refreshControl={
          <RefreshControl
            colors={[palette.primary]}
            onRefresh={() => void refreshActiveTab()}
            refreshing={Boolean(held.isRefreshing)}
            tintColor={palette.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
    );
  }

  return (
    <>
      <FlatList
        contentContainerStyle={styles.content}
        data={invoiceRows}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        keyExtractor={(invoice) => invoice.invoiceNumber}
        ListEmptyComponent={
          bootstrap.isLoading || history.isLoading ? (
            <Text style={styles.emptyState}>
              {bootstrap.isLoading
                ? "Loading POS workspace…"
                : "Loading invoice history…"}
            </Text>
          ) : historyError ? null : (
            <Text style={styles.emptyState}>
              No {filters.documentType === "Invoice" ? "invoices" : "orders"}{" "}
              match these filters.
            </Text>
          )
        }
        ListFooterComponent={
          history.data ? (
            <View>
              <View style={styles.pagination}>
                <Pressable
                  disabled={start === 0}
                  onPress={() =>
                    setStart((current) => Math.max(0, current - 25))
                  }
                  style={[
                    styles.paginationButton,
                    start === 0 && styles.paginationButtonDisabled,
                  ]}
                >
                  <Text style={styles.paginationLabel}>Previous</Text>
                </Pressable>
                <Pressable
                  disabled={!history.data.has_more}
                  onPress={() => setStart((current) => current + 25)}
                  style={[
                    styles.paginationButton,
                    !history.data.has_more && styles.paginationButtonDisabled,
                  ]}
                >
                  <Text style={styles.paginationLabel}>Next</Text>
                </Pressable>
              </View>
              <PosCacheStatus
                isOffline={isOffline}
                isRefreshing={history.isRefreshing}
                isStale={history.isStale}
                lastUpdated={history.lastUpdated}
              />
            </View>
          ) : null
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.heading}>
              <View style={styles.titleRow}>
                <Text style={styles.title}>Invoices</Text>
                <Pressable
                  accessibilityLabel="Back to POS"
                  onPress={onBackToPos}
                  style={styles.backToPosButton}
                >
                  <Text style={styles.backToPosButtonLabel}>Back to POS</Text>
                </Pressable>
              </View>
              <Text style={styles.subtitle}>
                {filters.documentType === "Draft Order"
                  ? "Review Sales Orders awaiting workflow approval."
                  : "Review completed sales from this POS workspace."}
              </Text>
            </View>

            {tabs}

            <View style={styles.filterActionRow}>
              <Text style={styles.filterSummary}>
                {activeFilterCount
                  ? `${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}`
                  : "All invoices in this shift"}
              </Text>
              <Pressable
                accessibilityLabel="Open invoice filters"
                onPress={openFilterSheet}
                style={styles.filtersButton}
              >
                <Text style={styles.filtersButtonLabel}>
                  {activeFilterCount
                    ? `Filters (${activeFilterCount})`
                    : "Filters"}
                </Text>
              </Pressable>
            </View>

            {historyError ? (
              <View style={styles.errorNotice}>
                <Text style={styles.errorText}>{historyError}</Text>
              </View>
            ) : null}
            {history.isRefreshing && history.data ? (
              <Text style={styles.refreshingText}>
                Refreshing invoice history…
              </Text>
            ) : null}

            {history.data ? (
              <View style={styles.summaryGrid}>
                <SummaryCard
                  label={
                    filters.documentType === "Invoice" ? "Invoices" : "Orders"
                  }
                  value={String(history.data.summary.invoice_count)}
                />
                <SummaryCard
                  label="Gross sales"
                  value={formatCurrency(
                    history.data.summary.gross_sales,
                    currency,
                  )}
                />
                <SummaryCard
                  label="Returns"
                  value={formatCurrency(history.data.summary.returns, currency)}
                />
                <SummaryCard
                  label="Outstanding"
                  value={formatCurrency(
                    history.data.summary.outstanding,
                    currency,
                  )}
                />
                <SummaryCard
                  label="Credit sales"
                  value={formatCurrency(
                    history.data.summary.credit_sales,
                    currency,
                  )}
                />
                <SummaryCard
                  label="Credit outstanding"
                  value={formatCurrency(
                    history.data.summary.credit_outstanding,
                    currency,
                  )}
                />
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <PosInvoiceListItem
            currencyPrecision={currencyPrecision}
            invoice={item}
            onPress={() =>
              onOpenInvoice({ doctype: item.doctype, name: item.invoiceNumber })
            }
          />
        )}
        refreshControl={
          <RefreshControl
            colors={[palette.primary]}
            onRefresh={() => void refreshActiveTab()}
            refreshing={Boolean(history.isRefreshing)}
            tintColor={palette.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      />
      <PosInvoiceFiltersSheet
        filters={draftFilters}
        onApply={applyFilters}
        onChange={updateDraftFilter}
        onClear={clearDraftFilters}
        onDismiss={() => setFilterSheetVisible(false)}
        paymentModes={
          bootstrap.data?.payment_modes.map(
            (payment) => payment.mode_of_payment,
          ) ?? []
        }
        visible={filterSheetVisible}
      />
    </>
  );
}

function createStyles(palette: AppPalette) {
  return StyleSheet.create({
    backToPosButton: {
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
    },
    backToPosButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    content: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    documentTabs: {
      borderBottomColor: palette.border,
      borderBottomWidth: 1,
      flexDirection: "row",
    },
    emptyState: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.body,
      paddingTop: spacing.xxl,
      textAlign: "center",
    },
    errorNotice: {
      backgroundColor: palette.errorSurface,
      borderColor: palette.error,
      borderRadius: radii.md,
      borderWidth: 1,
      padding: spacing.sm,
    },
    errorText: {
      color: palette.error,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
      lineHeight: typography.lineHeight.body,
    },
    documentTab: {
      borderBottomWidth: 2,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    documentTabActive: {
      borderBottomColor: palette.primary,
    },
    documentTabLabel: {
      fontFamily: typography.fontFamily.medium,
      fontSize: typography.size.small,
    },
    filterActionRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
    filterSummary: {
      color: palette.onSurfaceMuted,
      flex: 1,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
    filtersButton: {
      alignItems: "center",
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      justifyContent: "center",
      paddingHorizontal: spacing.sm,
    },
    filtersButtonLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    header: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
    },
    heldInvoiceAside: {
      alignItems: "flex-end",
      gap: spacing.sm,
    },
    heldInvoiceCard: {
      backgroundColor: palette.surfaceContainer,
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "space-between",
      padding: spacing.md,
    },
    heldInvoiceCustomer: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
    },
    heldInvoiceMain: { flex: 1, gap: 3 },
    heldInvoiceModified: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    heldInvoiceName: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    heldInvoiceTotal: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    heldSummaryRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
    heading: {
      gap: 4,
    },
    pagination: {
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "flex-end",
      paddingTop: spacing.lg,
    },
    paginationButton: {
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    paginationButtonDisabled: {
      opacity: 0.4,
    },
    paginationLabel: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.small,
    },
    refreshingText: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    restoreButton: {
      backgroundColor: palette.primary,
      borderRadius: radii.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    restoreButtonLabel: {
      color: palette.onPrimary,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.tiny,
    },
    separator: {
      height: spacing.sm,
    },
    subtitle: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.small,
      lineHeight: typography.lineHeight.body,
    },
    summaryCard: {
      backgroundColor: palette.surfaceContainer,
      borderColor: palette.border,
      borderRadius: radii.md,
      borderWidth: 1,
      flexBasis: "48%",
      flexGrow: 1,
      gap: 2,
      padding: spacing.sm,
    },
    summaryGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm,
    },
    summaryLabel: {
      color: palette.onSurfaceMuted,
      fontFamily: typography.fontFamily.regular,
      fontSize: typography.size.tiny,
    },
    summaryValue: {
      color: palette.onSurface,
      fontFamily: typography.fontFamily.semibold,
      fontSize: typography.size.body,
    },
    title: {
      color: palette.onSurface,
      flex: 1,
      fontFamily: typography.fontFamily.semibold,
      fontSize: 22,
    },
    titleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
    },
  });
}
