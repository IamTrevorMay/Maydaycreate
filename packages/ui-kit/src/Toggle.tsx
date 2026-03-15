import React from 'react';
import { theme } from './theme.js';

export interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, checked, onChange, disabled }: ToggleProps) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: theme.spacing.md, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <div
        onClick={() => !disabled && onChange(!checked)}
        style={{
          width: 28,
          height: 16,
          borderRadius: 8,
          background: checked ? theme.colors.accent.primary : theme.colors.bg.elevated,
          border: `1px solid ${theme.colors.border.default}`,
          position: 'relative',
          transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: theme.colors.text.primary,
          position: 'absolute',
          top: 1,
          left: checked ? 14 : 1,
          transition: 'left 0.2s',
        }} />
      </div>
      {label && <span style={{ fontSize: theme.fontSize.md, color: theme.colors.text.primary }}>{label}</span>}
    </label>
  );
}
