import React from 'react';
import { theme } from './theme.js';

export interface PanelProps {
  title?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

export function Panel({ title, children, style }: PanelProps) {
  return (
    <div style={{
      background: theme.colors.bg.tertiary,
      border: `1px solid ${theme.colors.border.default}`,
      borderRadius: theme.radius.lg,
      overflow: 'hidden',
      ...style,
    }}>
      {title && (
        <div style={{
          padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
          borderBottom: `1px solid ${theme.colors.border.default}`,
          fontSize: theme.fontSize.lg,
          fontWeight: 600,
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: theme.spacing.lg }}>
        {children}
      </div>
    </div>
  );
}
