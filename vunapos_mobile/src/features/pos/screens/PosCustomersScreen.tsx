import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { useState } from "react";
import { Text } from "react-native-paper";

import { formatPosCurrency } from "@/features/pos/currency";
import { PosCacheStatus } from "@/features/pos/components/PosCacheStatus";
import { PosCustomerFiltersSheet } from "@/features/pos/components/PosCustomerFiltersSheet";
import { usePosCustomerDirectory } from "@/features/pos/hooks/usePosCustomerDirectory";
import {
  PosCustomerDirectoryFilters,
  PosCustomerDirectoryRow,
} from "@/features/pos/types";
import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PosCustomersScreenProps = {
  customerManagementEnabled: boolean;
  currencyPrecision?: number;
  directoryState?: PosCustomerDirectoryViewState;
  onBackToPos: () => void;
  onDirectoryStateChange?: (state: PosCustomerDirectoryViewState) => void;
  onOpenCustomer?: (customer: string) => void;
  posProfile?: string;
};

const initialFilters: PosCustomerDirectoryFilters = {
  customerGroup: "",
  customerType: "",
  territory: "",
};

export type PosCustomerDirectoryViewState = {
  filters: PosCustomerDirectoryFilters;
  query: string;
  start: number;
};

export const initialCustomerDirectoryViewState: PosCustomerDirectoryViewState = {
  filters: initialFilters,
  query: "",
  start: 0,
};

/** Customer-tab access boundary and live first page of the POS directory. */
export function PosCustomersScreen({
  customerManagementEnabled,
  currencyPrecision = 2,
  directoryState,
  onBackToPos,
  onDirectoryStateChange,
  onOpenCustomer,
  posProfile,
}: PosCustomersScreenProps) {
  const { palette } = useAppearance();
  const { connectionStatus } = useNetworkStatus();
  const [localDirectoryState, setLocalDirectoryState] =
    useState<PosCustomerDirectoryViewState>(
      initialCustomerDirectoryViewState,
    );
  const currentDirectoryState = directoryState ?? localDirectoryState;
  const { filters, query, start } = currentDirectoryState;
  const [draftFilters, setDraftFilters] = useState<PosCustomerDirectoryFilters>(
    initialFilters,
  );
  const [filterSheetVisible, setFilterSheetVisible] = useState(false);
  const directory = usePosCustomerDirectory(
    customerManagementEnabled ? posProfile : undefined,
    query,
    filters,
    start,
  );
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  function openFilterSheet() {
    setDraftFilters(filters);
    setFilterSheetVisible(true);
  }

  function updateDirectoryState(nextState: PosCustomerDirectoryViewState) {
    if (directoryState && onDirectoryStateChange) {
      onDirectoryStateChange(nextState);
      return;
    }
    setLocalDirectoryState(nextState);
  }

  function applyFilters() {
    updateDirectoryState({ ...currentDirectoryState, filters: draftFilters, start: 0 });
    setFilterSheetVisible(false);
  }

  function clearDraftFilters() {
    setDraftFilters(initialFilters);
  }

  function updateDraftFilter<Key extends keyof PosCustomerDirectoryFilters>(
    field: Key,
    value: PosCustomerDirectoryFilters[Key],
  ) {
    setDraftFilters((current) => ({ ...current, [field]: value }));
  }

  function updateQuery(value: string) {
    updateDirectoryState({ ...currentDirectoryState, query: value, start: 0 });
  }

  function updatePage(nextStart: number) {
    updateDirectoryState({ ...currentDirectoryState, start: nextStart });
  }

  if (!posProfile) {
    return (
      <View
        accessibilityRole="progressbar"
        style={[styles.state, { backgroundColor: palette.background }]}
      >
        <ActivityIndicator color={palette.primary} />
        <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
          Loading POS Profile for customers…
        </Text>
      </View>
    );
  }

  if (!customerManagementEnabled) {
    return (
      <View style={[styles.state, { backgroundColor: palette.background }]}>
        <View
          accessibilityRole="alert"
          style={[
            styles.card,
            { backgroundColor: palette.surface, borderColor: palette.border },
          ]}
        >
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Customer management disabled
          </Text>
          <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
            Customer management is disabled for this POS Profile.
          </Text>
          <BackToPosButton onPress={onBackToPos} />
        </View>
      </View>
    );
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            colors={[palette.primary]}
            enabled={connectionStatus !== "offline"}
            onRefresh={() => void directory.reload()}
            refreshing={directory.isRefreshing}
            tintColor={palette.primary}
          />
        }
        showsVerticalScrollIndicator={false}
        style={{ backgroundColor: palette.background }}
      >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: palette.onSurface }]}>
            Customers
          </Text>
          <Text style={[styles.description, { color: palette.onSurfaceMuted }]}>
            Customers and balances you are permitted to view.
          </Text>
        </View>
        <BackToPosButton onPress={onBackToPos} />
      </View>
      <TextInput
        accessibilityLabel="Search customers"
        autoCapitalize="none"
        onChangeText={updateQuery}
        placeholder="Search name, mobile or email"
        placeholderTextColor={palette.onSurfaceMuted}
        style={[
          styles.searchInput,
          {
            backgroundColor: palette.surface,
            borderColor: palette.border,
            color: palette.onSurface,
          },
        ]}
        value={query}
      />
      <View style={styles.filterActionRow}>
        <Text style={[styles.filterSummary, { color: palette.onSurfaceMuted }]}>
          {activeFilterCount
            ? `${activeFilterCount} active filter${
                activeFilterCount === 1 ? "" : "s"
              }`
            : "All customers"}
        </Text>
        <Pressable
          accessibilityLabel="Open customer filters"
          accessibilityRole="button"
          onPress={openFilterSheet}
          style={[
            styles.filtersButton,
            { borderColor: palette.border, backgroundColor: palette.surface },
          ]}
        >
          <Text style={[styles.filtersButtonLabel, { color: palette.onSurface }]}>
            {activeFilterCount ? `Filters (${activeFilterCount})` : "Filters"}
          </Text>
        </Pressable>
      </View>

      {connectionStatus === "offline" && !directory.data ? (
        <DirectoryStateCard
          message="Reconnect to the server to load customers."
          palette={palette}
          tone="error"
        />
      ) : directory.isLoading ? (
        <View accessibilityRole="progressbar" style={styles.loadingState}>
          <ActivityIndicator color={palette.primary} />
          <Text style={[styles.stateText, { color: palette.onSurfaceMuted }]}>
            Loading customers…
          </Text>
        </View>
      ) : directory.error ? (
        <DirectoryStateCard message={directory.error} palette={palette} tone="error">
          <Pressable
            accessibilityLabel="Retry customers"
            accessibilityRole="button"
            onPress={directory.reload}
            style={[styles.retryButton, { borderColor: palette.border }]}
          >
            <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
              Retry
            </Text>
          </Pressable>
        </DirectoryStateCard>
      ) : directory.data?.customers.length ? (
        <>
          <View style={styles.customerList}>
            {directory.data.customers.map((customer) => (
              <CustomerDirectoryCard
                customer={customer}
                currencyPrecision={currencyPrecision}
                key={customer.customer}
                onPress={
                  onOpenCustomer
                    ? () => onOpenCustomer(customer.customer)
                    : undefined
                }
              />
            ))}
          </View>
          <DirectoryPagination
            directory={directory.data}
            start={start}
            onNext={() => updatePage(start + directory.data!.limit)}
            onPrevious={() => updatePage(Math.max(0, start - directory.data!.limit))}
          />
          <PosCacheStatus
            isOffline={connectionStatus === "offline"}
            isRefreshing={directory.isRefreshing}
            isStale={directory.isStale}
            lastUpdated={directory.lastUpdated}
          />
        </>
      ) : directory.data ? (
        <>
          <DirectoryStateCard
            message="No customers match these filters."
            palette={palette}
            tone="neutral"
          />
          <DirectoryPagination
            directory={directory.data}
            start={start}
            onNext={() => updatePage(start + directory.data!.limit)}
            onPrevious={() => updatePage(Math.max(0, start - directory.data!.limit))}
          />
          <PosCacheStatus
            isOffline={connectionStatus === "offline"}
            isRefreshing={directory.isRefreshing}
            isStale={directory.isStale}
            lastUpdated={directory.lastUpdated}
          />
        </>
      ) : null}
      </ScrollView>
      <PosCustomerFiltersSheet
        customerGroups={directory.data?.customer_groups ?? []}
        filters={draftFilters}
        onApply={applyFilters}
        onChange={updateDraftFilter}
        onClear={clearDraftFilters}
        onDismiss={() => setFilterSheetVisible(false)}
        territories={directory.data?.territories ?? []}
        visible={filterSheetVisible}
      />
    </>
  );
}

function DirectoryPagination({
  directory,
  start,
  onNext,
  onPrevious,
}: {
  directory: { as_of: string; limit: number; start: number; total_count: number };
  start: number;
  onNext: () => void;
  onPrevious: () => void;
}) {
  const { palette } = useAppearance();
  const atFirstPage = start === 0;
  const atLastPage = start + directory.limit >= directory.total_count;
  const customerCountLabel = `${directory.total_count} customer${
    directory.total_count === 1 ? "" : "s"
  }`;

  return (
    <View style={styles.pagination}>
      <Text style={[styles.paginationSummary, { color: palette.onSurfaceMuted }]}>
        {customerCountLabel}
      </Text>
      <View style={styles.paginationActions}>
        <Pressable
          accessibilityLabel="Previous customer page"
          accessibilityRole="button"
          disabled={atFirstPage}
          onPress={onPrevious}
          style={[
            styles.paginationButton,
            { borderColor: palette.border },
            atFirstPage && styles.disabled,
          ]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Previous
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Next customer page"
          accessibilityRole="button"
          disabled={atLastPage}
          onPress={onNext}
          style={[
            styles.paginationButton,
            { borderColor: palette.border },
            atLastPage && styles.disabled,
          ]}
        >
          <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
            Next
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function BackToPosButton({ onPress }: { onPress: () => void }) {
  const { palette } = useAppearance();
  return (
    <Pressable
      accessibilityLabel="Back to POS"
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.backButton, { borderColor: palette.border }]}
    >
      <Text style={[styles.backButtonLabel, { color: palette.onSurface }]}>
        Back to POS
      </Text>
    </Pressable>
  );
}

function CustomerDirectoryCard({
  currencyPrecision,
  customer,
  onPress,
}: {
  currencyPrecision: number;
  customer: PosCustomerDirectoryRow;
  onPress?: () => void;
}) {
  const { palette } = useAppearance();
  const identifier =
    customer.mobile_no || customer.email_id || customer.customer;
  const category = `${customer.customer_type || "-"} · ${
    customer.territory || "No territory"
  }`;

  return (
    <Pressable
      accessibilityLabel={`Open customer ${customer.customer_name}`}
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={[
        styles.customerCard,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <View style={styles.customerHeading}>
        <View style={styles.customerIdentity}>
          <Text style={[styles.customerName, { color: palette.onSurface }]}>
            {customer.customer_name}
          </Text>
          <Text style={[styles.meta, { color: palette.onSurfaceMuted }]}>
            {identifier}
          </Text>
        </View>
        <Text style={[styles.balance, { color: palette.onSurface }]}>
          {customer.outstanding_balance == null
            ? "Restricted"
            : formatPosCurrency(
                customer.outstanding_balance,
                customer.currency || "KES",
                currencyPrecision,
              )}
        </Text>
      </View>
      <View style={styles.customerDetails}>
        <DirectoryValue label="Group" value={customer.customer_group || "Uncategorized"} />
        <DirectoryValue label="Category" value={category} />
        <DirectoryValue
          label="Loyalty"
          value={
            customer.loyalty_points == null
              ? "Unavailable"
              : customer.loyalty_points.toLocaleString()
          }
        />
        <DirectoryValue
          label="Last purchase"
          value={
            customer.last_purchase_date
              ? formatDirectoryDate(customer.last_purchase_date)
              : "No purchases"
          }
        />
      </View>
    </Pressable>
  );
}

function DirectoryValue({ label, value }: { label: string; value: string }) {
  const { palette } = useAppearance();
  return (
    <View style={styles.directoryValue}>
      <Text style={[styles.valueLabel, { color: palette.onSurfaceMuted }]}>
        {label}
      </Text>
      <Text style={[styles.valueText, { color: palette.onSurface }]}>{value}</Text>
    </View>
  );
}

function DirectoryStateCard({
  children,
  message,
  palette,
  tone,
}: {
  children?: React.ReactNode;
  message: string;
  palette: ReturnType<typeof useAppearance>["palette"];
  tone: "error" | "neutral";
}) {
  return (
    <View
      accessibilityRole={tone === "error" ? "alert" : undefined}
      style={[
        styles.card,
        {
          backgroundColor:
            tone === "error" ? palette.errorSurface : palette.surface,
          borderColor: tone === "error" ? palette.error : palette.border,
        },
      ]}
    >
      <Text
        style={[
          styles.stateText,
          { color: tone === "error" ? palette.onError : palette.onSurfaceMuted },
        ]}
      >
        {message}
      </Text>
      {children}
    </View>
  );
}

function formatDirectoryDate(value: string) {
  const [year, month, day] = value.split(" ")[0].split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

const styles = StyleSheet.create({
  backButton: {
    alignItems: "center",
    alignSelf: "flex-start",
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
  balance: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
    textAlign: "right",
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
    width: "100%",
  },
  content: { flexGrow: 1, gap: spacing.md, padding: spacing.md },
  customerCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  customerDetails: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  customerHeading: { flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  customerIdentity: { flex: 1, gap: 2 },
  customerList: { gap: spacing.sm },
  customerName: { fontFamily: typography.fontFamily.semibold, fontSize: typography.size.body },
  description: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  directoryValue: { flexBasis: "46%", flexGrow: 1, gap: 2 },
  disabled: { opacity: 0.5 },
  filterActionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  filterSummary: {
    flex: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
  },
  filtersButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filtersButtonLabel: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.small,
  },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  heading: { flex: 1, gap: 4 },
  loadingState: { alignItems: "center", gap: spacing.sm, padding: spacing.xxl },
  meta: { fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
  pagination: { alignItems: "center", gap: spacing.sm },
  paginationActions: { flexDirection: "row", gap: spacing.sm },
  paginationButton: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    minWidth: 92,
    paddingHorizontal: spacing.md,
  },
  paginationSummary: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    textAlign: "center",
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
  searchInput: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  state: { flex: 1, gap: spacing.sm, justifyContent: "center", padding: spacing.lg },
  stateText: {
    fontFamily: typography.fontFamily.regular,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.body,
  },
  title: { fontFamily: typography.fontFamily.semibold, fontSize: 20 },
  valueLabel: { fontFamily: typography.fontFamily.medium, fontSize: typography.size.tiny },
  valueText: { fontFamily: typography.fontFamily.regular, fontSize: typography.size.small },
});
