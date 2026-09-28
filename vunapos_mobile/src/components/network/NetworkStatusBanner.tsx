import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useNetworkStatus } from "@/services/NetworkStatusProvider";
import {
  getRealtimeDiagnostics,
  subscribeRealtimeDiagnostics,
} from "@/sync/frappeRealtimeClient";
import {
  getServerReachabilityDiagnostics,
  subscribeServerReachability,
} from "@/sync/serverReachability";
import { useAppearance } from "@/theme/AppearanceProvider";
import { radii, spacing, typography } from "@/theme/tokens";

/** A non-blocking notice; individual server actions will be guarded separately. */
export function NetworkStatusBanner() {
  const { connectionStatus } = useNetworkStatus();
  const { palette } = useAppearance();
  const [realtime, setRealtime] = useState(getRealtimeDiagnostics);
  const [server, setServer] = useState(getServerReachabilityDiagnostics);

  useEffect(() => {
    const unsubscribe = subscribeRealtimeDiagnostics(() =>
      setRealtime(getRealtimeDiagnostics()),
    );
    const unsubscribeServer = subscribeServerReachability(() =>
      setServer(getServerReachabilityDiagnostics()),
    );
    return () => {
      unsubscribe();
      unsubscribeServer();
    };
  }, []);

  const deviceOffline = connectionStatus === "offline";
  const realtimeUnavailable =
    !deviceOffline && realtime.status === "error";
  const serverUnavailable =
    !deviceOffline && server.status === "unreachable";
  const sessionExpired =
    !deviceOffline && server.status === "session-expired";
  if (
    !deviceOffline &&
    !realtimeUnavailable &&
    !serverUnavailable &&
    !sessionExpired
  )
    return null;

  const message = deviceOffline
    ? "Connection unavailable. Reconnecting…"
    : serverUnavailable
      ? "Company server unavailable. Actions will retry when it is reachable."
      : sessionExpired
        ? "Your session has expired. Sign in again to continue."
        : "Realtime updates unavailable. Data will repair through server refresh.";

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
      <MaterialCommunityIcons
        color={palette.error}
        name={
          deviceOffline
            ? "wifi-off"
            : serverUnavailable
              ? "server-network-off"
              : sessionExpired
                ? "account-alert"
              : "sync-alert"
        }
        size={17}
      />
      <Text style={[styles.message, { color: palette.onError }]}>
        {message}
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
