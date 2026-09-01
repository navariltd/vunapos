import { MD3LightTheme } from 'react-native-paper';

import { colors, radii, typography } from '@/theme/tokens';

export const frappeTheme = {
  ...MD3LightTheme,
  roundness: radii.md / 4,
  colors: {
    ...MD3LightTheme.colors,
    background: colors.surface.canvas,
    error: colors.status.danger,
    errorContainer: colors.status.dangerSurface,
    onBackground: colors.ink.primary,
    onError: colors.surface.base,
    onErrorContainer: colors.status.dangerText,
    onPrimary: colors.surface.base,
    onSurface: colors.ink.primary,
    onSurfaceVariant: colors.ink.secondary,
    outline: colors.border.strong,
    outlineVariant: colors.border.subtle,
    primary: colors.ink.primary,
    primaryContainer: colors.ink.primary,
    secondary: colors.action.primary,
    surface: colors.surface.base,
    surfaceVariant: colors.surface.subtle,
  },
  fonts: {
    ...MD3LightTheme.fonts,
    bodyLarge: { ...MD3LightTheme.fonts.bodyLarge, fontFamily: typography.fontFamily.regular },
    bodyMedium: { ...MD3LightTheme.fonts.bodyMedium, fontFamily: typography.fontFamily.regular },
    bodySmall: { ...MD3LightTheme.fonts.bodySmall, fontFamily: typography.fontFamily.regular },
    labelLarge: { ...MD3LightTheme.fonts.labelLarge, fontFamily: typography.fontFamily.medium },
    titleMedium: { ...MD3LightTheme.fonts.titleMedium, fontFamily: typography.fontFamily.semibold },
  },
};
