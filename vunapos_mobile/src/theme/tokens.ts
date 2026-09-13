/**
 * Application design tokens. They are deliberately semantic rather than tied
 * to a screen or framework, so the same hierarchy holds in light and dark
 * appearances. The visual direction is modern Material 3 with the quiet,
 * high-density practicality familiar from Frappe—not a literal Frappe port.
 */
/** Semantic colours used by both application appearances. */
export type AppPalette = {
  background: string;
  border: string;
  borderSubtle: string;
  disabled: string;
  error: string;
  errorSurface: string;
  onError: string;
  onNotification: string;
  onPrimary: string;
  onSurface: string;
  onSurfaceMuted: string;
  notification: string;
  primary: string;
  scrim: string;
  success: string;
  surface: string;
  surfaceContainer: string;
  surfaceContainerHigh: string;
};

export const lightPalette: AppPalette = {
  background: "#f8f8f8",
  border: "#c7c7c7",
  borderSubtle: "#ededed",
  disabled: "#a3a3a3",
  error: "#cc2929",
  errorSurface: "#fff0f0",
  onError: "#941f1f",
  onNotification: "#ffffff",
  onPrimary: "#ffffff",
  onSurface: "#171717",
  onSurfaceMuted: "#525252",
  primary: "#16794c",
  notification: "#d32f2f",
  scrim: "rgba(23, 23, 23, 0.48)",
  success: "#16794c",
  surface: "#ffffff",
  surfaceContainer: "#f3f3f3",
  surfaceContainerHigh: "#e9e9e9",
};

export const darkPalette: AppPalette = {
  background: "#171717",
  border: "#383838",
  borderSubtle: "#2a2a2a",
  disabled: "#8a8a8a",
  error: "#eb9091",
  errorSurface: "#442126",
  onError: "#ffd9db",
  onNotification: "#ffffff",
  onPrimary: "#171717",
  onSurface: "#f8f8f8",
  onSurfaceMuted: "#c7c7c7",
  primary: "#e2e2e2",
  notification: "#d32f2f",
  scrim: "rgba(0, 0, 0, 0.64)",
  success: "#39b976",
  surface: "#1c1c1c",
  surfaceContainer: "#232323",
  surfaceContainerHigh: "#2a2a2a",
};

export const spacing = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
} as const;

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

export const typography = {
  fontFamily: {
    medium: "Inter_500Medium",
    regular: "Inter_400Regular",
    semibold: "Inter_600SemiBold",
  },
  lineHeight: {
    body: 21,
    compact: 18,
    heading: 30,
  },
  size: {
    body: 14,
    heading: 26,
    small: 13,
    tiny: 11,
  },
} as const;
