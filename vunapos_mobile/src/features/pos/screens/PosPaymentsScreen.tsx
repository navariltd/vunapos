import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";

import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

type PaymentWorkspaceTab = "receive" | "reconcile" | "history";

type PosPaymentsScreenProps = {
  allowHistory: boolean;
  allowReconciliation: boolean;
  allowReceive: boolean;
  onBackToPos: () => void;
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
  onBackToPos,
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, gap: spacing.lg, padding: spacing.md },
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
  title: {
    fontFamily: typography.fontFamily.semibold,
    fontSize: typography.size.heading,
    lineHeight: typography.lineHeight.heading,
  },
});
