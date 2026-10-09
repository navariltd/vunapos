import { createContext, PropsWithChildren, useContext, useState } from "react";
import { ActivityIndicator, Modal, StyleSheet, View } from "react-native";
import { Button, Text } from "react-native-paper";

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";
import { useAppSession } from "@/features/auth/AppSessionProvider";
import type { PosBootstrapState } from "@/features/pos/hooks/usePosBootstrap";
import type { PosBootstrapData } from "@/features/pos/types";
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

/** Changes only when the operational profile/stock scope changes, not for ordinary settings. */
export function posWorkspaceScopeKey(data: PosBootstrapData | null | undefined) {
  const profile = data?.pos_profile;
  return profile
    ? JSON.stringify([profile.name, profile.company ?? null, profile.warehouse ?? null])
    : null;
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
  const { companyUrl, sessionId } = useAppSession();
  const { palette } = useAppearance();
  const scope = authState === "signedIn" && companyUrl && sessionId
    ? JSON.stringify([companyUrl, sessionId]) : null;
  const [lastGood, setLastGood] = useState<{ scope: string; data: PosBootstrapData } | null>(
    () => scope && value.data && !value.isScopeInvalidated ? { scope, data: value.data } : null,
  );
  const currentProfile = scope && lastGood?.scope === scope
    ? lastGood.data.pos_profile.name : null;
  const nextProfile = value.data?.pos_profile.name;
  const currentOperationalScope = scope && lastGood?.scope === scope
    ? posWorkspaceScopeKey(lastGood.data) : null;
  const nextOperationalScope = posWorkspaceScopeKey(value.data);
  const profileSwitchPending = Boolean(
    scope && currentOperationalScope && nextOperationalScope &&
    currentOperationalScope !== nextOperationalScope &&
    !value.isScopeInvalidated,
  );
  const sameProfileScopeChange = profileSwitchPending && currentProfile === nextProfile;
  if (!scope && lastGood) {
    setLastGood(null);
  } else if (scope && value.data && !value.isScopeInvalidated && !profileSwitchPending &&
    (lastGood?.scope !== scope || lastGood.data !== value.data)) {
    setLastGood({ scope, data: value.data });
  }
  // Retain the mounted route only within the same authenticated scope. A
  // profile/access invalidation covers it with a blocking native modal.
  const retained = scope && lastGood?.scope === scope ? lastGood.data : null;
  const displayValue = authState !== "signedIn"
    ? { ...value, data: null }
    : (value.isScopeInvalidated || !value.data || profileSwitchPending) && retained
      ? {
          ...value,
          data: retained,
          hasHydratedCache: true,
          isHydratingCache: false,
          isInitialNetworkLoading: false,
          isLoading: false,
          isRefreshing: true,
          isScopeInvalidated: value.isScopeInvalidated || profileSwitchPending,
        }
      : value;
  if (
    authState === "signedIn" &&
    !displayValue.data &&
    (value.isHydratingCache || value.isInitialNetworkLoading)
  ) {
    return <AppLaunchScreen message="Preparing your workspace…" />;
  }
  if (authState === "signedIn" && !displayValue.data) {
    return (
      <PosWorkspaceUnavailable
        message={value.error ?? "Your POS Profile could not be loaded."}
        onRetry={() => void value.reload({ full: true })}
        onSignOut={onSignOut}
      />
    );
  }
  return (
    <PosBootstrapSnapshotProvider value={displayValue}>
      {children}
      {authState === "signedIn" && (value.isScopeInvalidated || profileSwitchPending) ? (
        <Modal animationType="none" onRequestClose={() => {}} transparent visible>
          {profileSwitchPending ? (
            <View style={[styles.unavailable, { backgroundColor: palette.background }]}>
              <Text variant="titleMedium">
                {sameProfileScopeChange ? "POS company or warehouse changed" : "POS Profile changed"}
              </Text>
              <Text style={{ color: palette.onSurfaceMuted, textAlign: "center" }}>
                {sameProfileScopeChange
                  ? "This sale cannot continue in the previous company or warehouse. The old cart and unsaved checkout entries will not be carried into the new scope."
                  : `Your new POS Profile is ${nextProfile}. This sale cannot continue under the old profile. Your old cart remains stored in its original profile, but unsaved checkout form entries will not move to the new profile.`}
              </Text>
              <Button mode="contained" onPress={() => {
                if (!scope || !value.data) return;
                // Draft cache keys include ERP company and warehouse, so scope
                // handoff never depends on an asynchronous SQLite deletion.
                setLastGood({ scope, data: value.data });
              }}>{sameProfileScopeChange ? "Open new POS scope" : "Open new POS Profile"}</Button>
              {onSignOut ? <Button onPress={() => void onSignOut()}>Sign out</Button> : null}
            </View>
          ) : value.error ? (
            <PosWorkspaceUnavailable
              message={value.error}
              onRetry={() => void value.reload({ full: true })}
              onSignOut={onSignOut}
            />
          ) : (
            <View style={[styles.unavailable, { backgroundColor: palette.background }]}>
              <ActivityIndicator accessibilityLabel="Checking POS access" />
              <Text variant="titleMedium">Checking POS access…</Text>
              <Text style={{ color: palette.onSurfaceMuted, textAlign: "center" }}>
                Your current sale is preserved while your POS Profile is verified.
              </Text>
            </View>
          )}
        </Modal>
      ) : null}
    </PosBootstrapSnapshotProvider>
  );
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
