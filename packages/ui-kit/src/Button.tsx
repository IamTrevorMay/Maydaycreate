import React from 'react';
import { theme } from './theme.js';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}

export function Button({ variant = 'secondary', size = 'md', style, children, ...props }: ButtonProps) {
  const variants = {
    primary: { background: theme.colors.accent.primary, color: '#fff', border: 'none' },
    secondary: { background: theme.colors.bg.tertiary, color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.default}` },
    ghost: { background: 'transparent', color: theme.colors.text.secondary, border: 'none' },
    danger: { background: theme.colors.status.errorBg, color: theme.colors.status.error, border: `1px solid ${theme.colors.status.error}33` },
  };

  const sizes = {
    sm: { padding: '2px 8px', fontSize: theme.fontSize.sm },
    md: { padding: '4px 12px', fontSize: theme.fontSize.md },
  };

  return (
    <button
      style={{
        ...variants[variant],
        ...sizes[size],
        borderRadius: theme.radius.md,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        opacity: props.disabled ? 0.5 : 1,
        fontFamily: theme.fontFamily,
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
