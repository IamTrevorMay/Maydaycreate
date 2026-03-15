import React from 'react';
import type { HistorySnapshot as Snapshot } from '@mayday/sync-engine';
import { c } from '../styles.js';

interface Props {
  snapshot: Snapshot;
  onRestore: (snapshot: Snapshot) => void;
}

export function HistorySnapshotRow({ snapshot, onRestore }: Props): React.ReactElement {
  const date = new Date(snapshot.timestamp).toLocaleString();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '10px 16px',
        borderBottom: `1px solid ${c.border.default}`,
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: c.text.primary }}>{date}</div>
        <div style={{ fontSize: 10, color: c.text.disabled, marginTop: 2 }}>
          {snapshot.machineName} · {snapshot.files.length} file{snapshot.files.length !== 1 ? 's' : ''}
        </div>
      </div>
      <button
        onClick={() => onRestore(snapshot)}
        style={{
          padding: '4px 12px',
          borderRadius: 4,
          border: `1px solid ${c.border.hover}`,
          background: 'transparent',
          color: c.text.secondary,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        Restore
      </button>
    </div>
  );
}
