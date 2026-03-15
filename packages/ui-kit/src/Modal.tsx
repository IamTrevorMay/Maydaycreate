import React from 'react';
import { theme } from './theme.js';

export interface ModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function Modal({ open, title, onClose, children }: ModalProps) {
  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: theme.colors.bg.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          borderRadius: theme.radius.lg,
          minWidth: 240,
          maxWidth: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div style={{
            padding: `${theme.spacing.lg}px ${theme.spacing.xl}px`,
            borderBottom: `1px solid ${theme.colors.border.default}`,
            fontWeight: 600,
            fontSize: theme.fontSize.lg,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            {title}
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: theme.colors.text.secondary,
                cursor: 'pointer',
                fontSize: theme.fontSize.xl,
                padding: 0,
                lineHeight: 1,
              }}
            >
              x
            </button>
          </div>
        )}
        <div style={{ padding: theme.spacing.xl }}>
          {children}
        </div>
      </div>
    </div>
  );
}
