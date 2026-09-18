import { MD3DarkTheme, MD3LightTheme } from "react-native-paper";

import { AppPalette, radii, typography } from "@/theme/tokens";

/** Adapts the app tokens to React Native Paper's Material 3 theme contract. */
export function createFrappeTheme(palette: AppPalette, isDark: boolean) {
  const baseTheme = isDark ? MD3DarkTheme : MD3LightTheme;
  return {
    ...baseTheme,
    roundness: radii.md / 4,
    colors: {
      ...baseTheme.colors,
      background: palette.background,
      error: palette.error,
      errorContainer: palette.errorSurface,
      onBackground: palette.onSurface,
      onError: palette.onPrimary,
      onErrorContainer: palette.onError,
      onPrimary: palette.onPrimary,
      onSurface: palette.onSurface,
      onSurfaceVariant: palette.onSurfaceMuted,
      outline: palette.border,
      outlineVariant: palette.borderSubtle,
      primary: palette.primary,
      primaryContainer: palette.primary,
      secondary: palette.success,
      surface: palette.surface,
      surfaceVariant: palette.surfaceContainer,
    },
    fonts: {
      ...baseTheme.fonts,
      bodyLarge: {
        ...baseTheme.fonts.bodyLarge,
        fontFamily: typography.fontFamily.regular,
      },
      bodyMedium: {
        ...baseTheme.fonts.bodyMedium,
        fontFamily: typography.fontFamily.regular,
      },
      bodySmall: {
        ...baseTheme.fonts.bodySmall,
        fontFamily: typography.fontFamily.regular,
      },
      labelLarge: {
        ...baseTheme.fonts.labelLarge,
        fontFamily: typography.fontFamily.medium,
      },
      titleMedium: {
        ...baseTheme.fonts.titleMedium,
        fontFamily: typography.fontFamily.semibold,
      },
    },
  };
}
