import { createContext, PropsWithChildren, useContext } from "react";
import { StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";
import type { PosBootstrapState } from "@/features/pos/hooks/usePosBootstrap";
import { useAppearance } from "@/theme/AppearanceProvider";
import { spacing } from "@/theme/tokens";

const PosBootstrapSnapshotContext = createContext<PosBootstrapState | null>(null);

/** Shares the root-owned POS snapshot without creating a second cache or store. */
export function PosBootstrapSnapshotProvider({
  children,
  value,
}: PropsWithChildren<{ value: PosBootstrapState }>) {
  return (
    <PosBootstrapSnapshotContext.Provider value={value}>
      {children}
    </PosBootstrapSnapshotContext.Provider>
  );
}

export function useRootPosBootstrapSnapshot() {
  return useContext(PosBootstrapSnapshotContext);
}

/** Hold route mounting only until the first scoped snapshot has been resolved. */
export function PosBootstrapSnapshotBoundary({
  authState,
  children,
  onSignOut,
  value,
}: PropsWithChildren<{
  authState: string;
  onSignOut?: () => void | Promise<void>;
  value: PosBootstrapState;
}>) {
  if (
    authState === "signedIn" &&
    (value.isHydratingCache || value.isInitialNetworkLoading)
  ) {
    return <AppLaunchScreen message="Preparing your workspace…" />;
  }
  if (authState === "signedIn" && !value.data) {
    return (
      <PosWorkspaceUnavailable
        message={value.error ?? "Your POS Profile could not be loaded."}
        onRetry={() => void value.reload({ full: true })}
        onSignOut={onSignOut}
      />
    );
  }
  return <PosBootstrapSnapshotProvider value={value}>{children}</PosBootstrapSnapshotProvider>;
}

function PosWorkspaceUnavailable({
  message,
  onRetry,
  onSignOut,
}: {
  message: string;
  onRetry: () => void;
  onSignOut?: () => void | Promise<void>;
}) {
  const { palette } = useAppearance();
  return (
    <View style={[styles.unavailable, { backgroundColor: palette.background }]}>
      <Text variant="titleMedium">POS unavailable</Text>
      <Text style={{ color: palette.onSurfaceMuted, textAlign: "center" }}>{message}</Text>
      <Button mode="contained" onPress={onRetry}>Try again</Button>
      {onSignOut ? <Button onPress={() => void onSignOut()}>Sign out</Button> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  unavailable: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
});
