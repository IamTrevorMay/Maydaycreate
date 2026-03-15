import React, { useEffect } from 'react';
import { theme } from './theme.js';

export interface ToastProps {
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  onClose: () => void;
  duration?: number;
}

export function Toast({ message, type = 'info', onClose, duration = 4000 }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const colorMap = {
    info: { bg: theme.colors.status.infoBg, text: theme.colors.status.info },
    success: { bg: theme.colors.status.successBg, text: theme.colors.status.success },
    warning: { bg: theme.colors.status.warningBg, text: theme.colors.status.warning },
    error: { bg: theme.colors.status.errorBg, text: theme.colors.status.error },
  };

  const colors = colorMap[type];

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        bottom: theme.spacing.lg,
        left: theme.spacing.lg,
        right: theme.spacing.lg,
        background: colors.bg,
        color: colors.text,
        border: `1px solid ${colors.text}33`,
        borderRadius: theme.radius.md,
        padding: `${theme.spacing.md}px ${theme.spacing.lg}px`,
        fontSize: theme.fontSize.md,
        cursor: 'pointer',
        zIndex: 1000,
      }}
    >
      {message}
    </div>
  );
}
