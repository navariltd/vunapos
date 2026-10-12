import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";
import { LaunchReadyContext } from "@/components/splash/LaunchReadiness";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import {
  AppSessionProvider,
  useAppSession,
} from "@/features/auth/AppSessionProvider";
import { NetworkStatusProvider } from "@/services/NetworkStatusProvider";
import { useFrappeRealtime } from "@/sync/useFrappeRealtime";
import { usePosQueueRealtime } from "@/sync/usePosQueueRealtime";
import { usePosRefreshTriggers } from "@/sync/usePosRefreshTriggers";
import { usePosRealtimeCoordinator } from "@/sync/usePosRealtimeCoordinator";
import { PosBootstrapSnapshotBoundary } from "@/sync/PosBootstrapSnapshot";
import { AppearanceProvider, useAppearance } from "@/theme/AppearanceProvider";

SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 240, fade: true });

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <AppearanceProvider>
          <NetworkStatusProvider>
            <ToastProvider>
              <AppSessionProvider>
                <RootNavigator fontsLoaded={fontsLoaded} />
              </AppSessionProvider>
            </ToastProvider>
          </NetworkStatusProvider>
        </AppearanceProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const posBootstrap = usePosRealtimeCoordinator();
  useFrappeRealtime(posBootstrap.data?.site_name);
  usePosQueueRealtime();
  usePosRefreshTriggers();
  const { authState, isBootstrapping, signOut } = useAppSession();
  const { isReady: isAppearanceReady } = useAppearance();
  const [launchVisible, setLaunchVisible] = useState(true);
  const nativeSplashHidden = useRef(false);
  const destinationReady = useRef(false);
  const hideNativeSplash = useCallback(() => {
    if (nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;
    void SplashScreen.hideAsync();
  }, []);
  const finishInitialLaunch = useCallback(() => {
    if (destinationReady.current) return;
    destinationReady.current = true;
    requestAnimationFrame(() => {
      hideNativeSplash();
      setLaunchVisible(false);
    });
  }, [hideNativeSplash]);

  const canRoute = fontsLoaded && !isBootstrapping && isAppearanceReady;

  return (
    <LaunchReadyContext.Provider value={finishInitialLaunch}>
      <View style={styles.root}>
        {canRoute ? (
          <PosBootstrapSnapshotBoundary
            authState={authState}
            initialFallback={launchVisible ? null : undefined}
            onSignOut={signOut}
            value={posBootstrap}
          >
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
            </Stack>
          </PosBootstrapSnapshotBoundary>
        ) : null}
        {launchVisible ? (
          <View style={StyleSheet.absoluteFill}>
            <AppLaunchScreen
              message="Preparing your workspace…"
              onReady={hideNativeSplash}
            />
          </View>
        ) : null}
      </View>
    </LaunchReadyContext.Provider>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
