import { MaterialCommunityIcons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

/** A non-blocking notice; individual server actions will be guarded separately. */
export function NetworkStatusBanner() {
  const { connectionStatus } = useNetworkStatus();
  const { palette } = useAppearance();

  if (connectionStatus !== "offline") return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.container,
        {
          backgroundColor: palette.errorSurface,
          borderColor: palette.error,
        },
      ]}
      testID="network-status-banner"
    >
      <MaterialCommunityIcons color={palette.error} name="wifi-off" size={17} />
      <Text style={[styles.message, { color: palette.onError }]}>
        Connection unavailable. Reconnecting…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  message: {
    fontFamily: typography.fontFamily.medium,
    fontSize: typography.size.small,
    lineHeight: typography.lineHeight.compact,
  },
});
