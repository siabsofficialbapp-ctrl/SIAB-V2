/**
 * SIAB design tokens. White and cyan, as specified.
 *
 * One source of truth for both the Expo client and any future web surface.
 * Components import from here; no component invents its own hex value.
 */

export const palette = {
  // Brand
  cyan50: '#ECFEFF',
  cyan100: '#CFFAFE',
  cyan200: '#A5F3FC',
  cyan300: '#67E8F9',
  cyan400: '#22D3EE',
  cyan500: '#06B6D4',
  cyan600: '#0891B2',
  cyan700: '#0E7490',
  cyan900: '#164E63',

  white: '#FFFFFF',
  // Neutrals, cool-tinted so they sit with the cyan rather than fighting it.
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray900: '#0F172A',

  // Status
  red500: '#DC2626',
  orange500: '#F97316',
  green600: '#16A34A',
  amber500: '#F59E0B',
} as const;

export const theme = {
  color: {
    background: palette.white,
    surface: palette.white,
    surfaceMuted: palette.gray50,
    border: palette.gray200,
    borderStrong: palette.gray300,

    primary: palette.cyan500,
    primaryPressed: palette.cyan600,
    primarySubtle: palette.cyan50,
    onPrimary: palette.white,

    text: palette.gray900,
    textMuted: palette.gray500,
    textInverse: palette.white,

    success: palette.green600,
    warning: palette.amber500,
    danger: palette.red500,
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  fontSize: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28 },
  fontWeight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  shadow: {
    card: {
      shadowColor: palette.gray900,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
  },
} as const;

/** Order status → the colour its badge is painted. */
export const ORDER_STATUS_COLOR: Record<string, string> = {
  awaiting_payment: palette.gray400,
  confirmed: palette.cyan500,
  processing: palette.cyan600,
  shipped: palette.cyan700,
  delivered: palette.amber500,
  completed: palette.green600,
  cancelled: palette.red500,
};
