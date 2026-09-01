/**
 * Native translation of the Frappe Desk/Frappe UI foundations used by the SPA.
 * Keep all visual values here so future screens remain visually consistent.
 */
export const colors = {
  action: {
    primary: '#16794c',
  },
  border: {
    strong: '#c7c7c7',
    subtle: '#ededed',
  },
  ink: {
    muted: '#737373',
    primary: '#171717',
    secondary: '#525252',
  },
  status: {
    danger: '#cc2929',
    dangerSurface: '#fff0f0',
    dangerText: '#941f1f',
    success: '#16794c',
  },
  surface: {
    base: '#ffffff',
    canvas: '#f8f8f8',
    elevated: '#ffffff',
    subtle: '#f3f3f3',
  },
} as const;

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
    medium: 'Inter_500Medium',
    regular: 'Inter_400Regular',
    semibold: 'Inter_600SemiBold',
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
