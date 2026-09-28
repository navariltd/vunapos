import { NavigationBar } from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState, useColorScheme } from "react-native";
import { PaperProvider } from "react-native-paper";

import {
  AppearancePreference,
  loadAppearancePreference,
  persistAppearancePreference,
} from "@/services/appearanceStore";
import { createFrappeTheme } from "@/theme/frappeTheme";
import { AppPalette, darkPalette, lightPalette } from "@/theme/tokens";

export type ResolvedAppearance = "dark" | "light";

type AppearanceContextValue = {
  appearance: ResolvedAppearance;
  isReady: boolean;
  palette: AppPalette;
  preference: AppearancePreference;
  setPreference: (preference: AppearancePreference) => Promise<void>;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const fallbackAppearance: AppearanceContextValue = {
  appearance: "light",
  isReady: true,
  palette: lightPalette,
  preference: "system",
  setPreference: async () => undefined,
};

export function resolveAppearance(
  preference: AppearancePreference,
  systemScheme: string | null | undefined,
): ResolvedAppearance {
  if (preference === "dark" || preference === "light") return preference;
  return systemScheme === "dark" ? "dark" : "light";
}

export function AppearanceProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setStoredPreference] =
    useState<AppearancePreference>("system");
  const [isReady, setIsReady] = useState(false);
  const appearance = resolveAppearance(preference, systemScheme);
  const palette = appearance === "dark" ? darkPalette : lightPalette;
  const paperTheme = useMemo(
    () => createFrappeTheme(palette, appearance === "dark"),
    [appearance, palette],
  );

  useEffect(() => {
    let mounted = true;
    void loadAppearancePreference()
      .then((stored) => {
        if (mounted && stored) setStoredPreference(stored);
      })
      .finally(() => {
        if (mounted) setIsReady(true);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background);
  }, [palette.background]);

  const setPreference = useCallback(
    async (nextPreference: AppearancePreference) => {
      setStoredPreference(nextPreference);
      await persistAppearancePreference(nextPreference);
    },
    [],
  );

  const value = useMemo(
    () => ({ appearance, isReady, palette, preference, setPreference }),
    [appearance, isReady, palette, preference, setPreference],
  );

  return (
    <AppearanceContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>
        <StatusBar style={appearance === "dark" ? "light" : "dark"} />
        <SafeNavigationBar appearance={appearance} />
        {children}
      </PaperProvider>
    </AppearanceContext.Provider>
  );
}

function SafeNavigationBar({ appearance }: { appearance: ResolvedAppearance }) {
  useEffect(() => {
    let active = AppState.currentState === "active";
    const subscription = AppState.addEventListener("change", (state) => {
      active = state === "active";
      if (active) applyNavigationBarStyle(appearance);
    });

    if (active) applyNavigationBarStyle(appearance);
    return () => subscription.remove();
  }, [appearance]);

  return null;
}

function applyNavigationBarStyle(appearance: ResolvedAppearance) {
  try {
    void Promise.resolve(
      NavigationBar.setStyle(appearance === "dark" ? "dark" : "light"),
    ).catch(() => undefined);
  } catch {
    // The Android activity may disappear during backgrounding or reload.
  }
}

export function useAppearance() {
  const context = useContext(AppearanceContext);
  return context ?? fallbackAppearance;
}
