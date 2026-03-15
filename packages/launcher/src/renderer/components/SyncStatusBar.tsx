import React from 'react';
import type { SyncStatus } from '@mayday/sync-engine';
import { c } from '../styles.js';

interface Props {
  status: SyncStatus;
  onSyncNow: () => void;
}

const STATE_COLOR: Record<string, string> = {
  idle: c.status.success,
  syncing: c.status.info,
  error: c.status.error,
  offline: c.status.warning,
};

const STATE_LABEL: Record<string, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  error: 'Sync error',
  offline: 'Offline',
};

export function SyncStatusBar({ status, onSyncNow }: Props): React.ReactElement {
  const color = STATE_COLOR[status.state] ?? c.text.secondary;
  const label = STATE_LABEL[status.state] ?? status.state;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '6px 16px',
        background: '#1a1a1a',
        borderBottom: `1px solid ${c.border.default}`,
        height: 32,
        flexShrink: 0,
      }}
    >
      {/* Status dot + label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: color,
          }}
        />
        <span style={{ fontSize: 11, color: c.text.secondary }}>{label}</span>
      </div>

      {/* Badges */}
      {status.conflictCount > 0 && (
        <Badge label={`${status.conflictCount} conflict${status.conflictCount !== 1 ? 's' : ''}`} color={c.status.error} />
      )}
      {status.pendingCount > 0 && (
        <Badge label={`${status.pendingCount} pending`} color={c.status.warning} />
      )}

      <div style={{ flex: 1 }} />

      {status.lastSyncedAt && (
        <span style={{ fontSize: 10, color: c.text.disabled }}>
          Last: {new Date(status.lastSyncedAt).toLocaleTimeString()}
        </span>
      )}

      <button
        onClick={onSyncNow}
        disabled={status.state === 'syncing'}
        style={{
          padding: '2px 10px',
          borderRadius: 4,
          border: 'none',
          fontSize: 11,
          background: c.accent.primary,
          color: '#fff',
          cursor: status.state === 'syncing' ? 'not-allowed' : 'pointer',
          opacity: status.state === 'syncing' ? 0.6 : 1,
        }}
      >
        Sync Now
      </button>
    </div>
  );
}

function Badge({ label, color }: { label: string; color: string }): React.ReactElement {
  return (
    <span
      style={{
        padding: '1px 6px',
        borderRadius: 10,
        fontSize: 10,
        background: color + '22',
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}
