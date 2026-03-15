import React from 'react';
import { theme } from './theme.js';

export interface SliderProps {
  label?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  showValue?: boolean;
}

export function Slider({ label, value, min = 0, max = 100, step = 1, onChange, showValue = true }: SliderProps) {
  return (
    <div style={{ marginBottom: theme.spacing.md }}>
      {label && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: theme.spacing.xs }}>
          <label style={{ fontSize: theme.fontSize.sm, color: theme.colors.text.secondary }}>{label}</label>
          {showValue && <span style={{ fontSize: theme.fontSize.sm, color: theme.colors.text.primary }}>{value}</span>}
        </div>
      )}
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: theme.colors.accent.primary }}
      />
    </div>
  );
}
