import React from 'react';
import { theme } from './theme.js';

export interface ProgressBarProps {
  value: number;
  label?: string;
  style?: React.CSSProperties;
}

export function ProgressBar({ value, label, style }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div style={{ marginBottom: theme.spacing.md, ...style }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs }}>
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.text.secondary }}>{label}</span>
          <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.text.primary }}>{Math.round(clamped)}%</span>
        </div>
      )}
      <div style={{
        height: 4,
        background: theme.colors.bg.primary,
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${clamped}%`,
          background: theme.colors.accent.primary,
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}
