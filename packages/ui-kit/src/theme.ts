/** Premiere Pro-inspired design tokens */

export const theme = {
  colors: {
    bg: {
      primary: '#1e1e1e',
      secondary: '#232323',
      tertiary: '#2a2a2a',
      elevated: '#303030',
      hover: '#383838',
    },
    text: {
      primary: '#e0e0e0',
      secondary: '#999999',
      disabled: '#666666',
      inverse: '#1e1e1e',
    },
    accent: {
      primary: '#2680eb',
      hover: '#3b91f7',
      active: '#1a6fd4',
    },
    border: {
      default: '#333333',
      hover: '#444444',
      focus: '#2680eb',
    },
    status: {
      success: '#4ade80',
      successBg: '#1b4332',
      warning: '#fbbf24',
      warningBg: '#422006',
      error: '#f87171',
      errorBg: '#442222',
      info: '#60a5fa',
      infoBg: '#1e3a5f',
    },
  },
  spacing: {
    xs: 2,
    sm: 4,
    md: 8,
    lg: 12,
    xl: 16,
    xxl: 24,
  },
  radius: {
    sm: 2,
    md: 4,
    lg: 6,
  },
  fontSize: {
    xs: 9,
    sm: 10,
    md: 12,
    lg: 13,
    xl: 16,
  },
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
} as const;

export type Theme = typeof theme;
