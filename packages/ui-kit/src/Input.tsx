import React from 'react';
import { theme } from './theme.js';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, style, ...props }: InputProps) {
  return (
    <div style={{ marginBottom: theme.spacing.md }}>
      {label && (
        <label style={{ display: 'block', fontSize: theme.fontSize.sm, color: theme.colors.text.secondary, marginBottom: theme.spacing.xs }}>
          {label}
        </label>
      )}
      <input
        style={{
          width: '100%',
          background: theme.colors.bg.primary,
          color: theme.colors.text.primary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: theme.radius.md,
          padding: '4px 8px',
          fontSize: theme.fontSize.md,
          fontFamily: theme.fontFamily,
          outline: 'none',
          ...style,
        }}
        {...props}
      />
    </div>
  );
}
