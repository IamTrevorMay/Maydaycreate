/** Inline style helpers using the Mayday design tokens */

export const c = {
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
  },
  accent: {
    primary: '#2680eb',
    hover: '#3b91f7',
  },
  border: {
    default: '#333333',
    hover: '#444444',
  },
  status: {
    success: '#4ade80',
    warning: '#fbbf24',
    error: '#f87171',
    info: '#60a5fa',
  },
} as const;
