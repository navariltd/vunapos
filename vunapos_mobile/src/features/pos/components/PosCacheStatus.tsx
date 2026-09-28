import { StyleSheet, Text } from "react-native";

import { useAppearance } from "@/theme/AppearanceProvider";
import { spacing, typography } from "@/theme/tokens";

type PosCacheStatusProps = {
  isOffline: boolean;
  isRefreshing?: boolean;
  isStale?: boolean;
  lastUpdated: number | null | undefined;
};

export function formatCacheTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(timestamp));
}

/** A quiet list footer, matching the Customers tab's natural update summary. */
export function PosCacheStatus({
  isOffline,
  isRefreshing = false,
  isStale = false,
  lastUpdated,
}: PosCacheStatusProps) {
  const { palette } = useAppearance();
  const timestamp = lastUpdated ? formatCacheTimestamp(lastUpdated) : null;
  const label = isOffline
    ? timestamp
      ? `Offline · Updated ${timestamp}`
      : "Offline · saved data unavailable"
    : isRefreshing
      ? timestamp
        ? `Refreshing · Updated ${timestamp}`
        : "Refreshing catalogue"
      : isStale
        ? timestamp
          ? `Saved data may be outdated · Updated ${timestamp}`
          : "Saved data may be outdated"
        : timestamp
          ? `Updated ${timestamp}`
          : null;

  if (!label) return null;
  return <Text style={[styles.label, { color: palette.onSurfaceMuted }]}>{label}</Text>;
}

const styles = StyleSheet.create({
  label: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.tiny,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    textAlign: "center",
  },
});
