import React from 'react';
import type { OfflineQueueEntry } from '@mayday/sync-engine';
import { c } from '../styles.js';

interface Props {
  queue: OfflineQueueEntry[];
  onFlush: () => void;
}

export function QueueSummary({ queue, onFlush }: Props): React.ReactElement | null {
  if (queue.length === 0) return null;

  return (
    <div
      style={{
        background: c.status.warning + '18',
        border: `1px solid ${c.status.warning}44`,
        borderRadius: 6,
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <span style={{ fontSize: 12, color: c.status.warning, flex: 1 }}>
        {queue.length} pending change{queue.length !== 1 ? 's' : ''} — sync source unavailable when these were made
      </span>
      <button
        onClick={onFlush}
        style={{
          padding: '4px 12px',
          borderRadius: 4,
          border: 'none',
          background: c.status.warning,
          color: '#1e1e1e',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        Sync Now
      </button>
    </div>
  );
}
