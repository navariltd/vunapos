import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useCallback } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppLaunchScreen } from "@/components/splash/AppLaunchScreen";
import { ToastProvider } from "@/components/feedback/ToastProvider";
import {
  AppSessionProvider,
  useAppSession,
} from "@/features/auth/AppSessionProvider";
import { NetworkStatusProvider } from "@/services/NetworkStatusProvider";
import { useFrappeRealtime } from "@/sync/useFrappeRealtime";
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
  useFrappeRealtime();
  const { isBootstrapping } = useAppSession();
  const { isReady: isAppearanceReady } = useAppearance();
  const hideNativeSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  if (!fontsLoaded || isBootstrapping || !isAppearanceReady) {
    return (
      <AppLaunchScreen
        message="Preparing your workspace…"
        onReady={hideNativeSplash}
      />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}
