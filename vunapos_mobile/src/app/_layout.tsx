import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AppLaunchScreen } from '@/components/splash/AppLaunchScreen';
import { AppSessionProvider, useAppSession } from '@/features/auth/AppSessionProvider';
import { frappeTheme } from '@/theme/frappeTheme';

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
      <PaperProvider theme={frappeTheme}>
        <AppSessionProvider>
          <RootNavigator fontsLoaded={fontsLoaded} />
        </AppSessionProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function RootNavigator({ fontsLoaded }: { fontsLoaded: boolean }) {
  const { isBootstrapping } = useAppSession();
  const hideNativeSplash = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  if (!fontsLoaded || isBootstrapping) {
    return <AppLaunchScreen message="Preparing workspace…" onReady={hideNativeSplash} />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}
