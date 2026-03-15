import React from 'react';
import { theme } from './theme.js';

export interface SelectOption {
  label: string;
  value: string | number;
}

export interface SelectProps {
  label?: string;
  options: SelectOption[];
  value: string | number;
  onChange: (value: string) => void;
  style?: React.CSSProperties;
}

export function Select({ label, options, value, onChange, style }: SelectProps) {
  return (
    <div style={{ marginBottom: theme.spacing.md }}>
      {label && (
        <label style={{ display: 'block', fontSize: theme.fontSize.sm, color: theme.colors.text.secondary, marginBottom: theme.spacing.xs }}>
          {label}
        </label>
      )}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
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
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
