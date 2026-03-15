import React from 'react';
import type { SyncConflict } from '@mayday/sync-engine';
import { c } from '../styles.js';

interface Props {
  conflict: SyncConflict;
  onKeepMine: () => void;
  onUseTheirs: () => void;
}

export function ConflictDiff({ conflict, onKeepMine, onUseTheirs }: Props): React.ReactElement {
  const localDate = new Date(conflict.localMtime).toLocaleString();
  const remoteDate = new Date(conflict.remoteMtime).toLocaleString();
  const remoteMachines = conflict.remoteMachineNames.join(', ') || 'Remote';

  return (
    <div
      style={{
        border: `1px solid ${c.border.default}`,
        borderRadius: 6,
        overflow: 'hidden',
        background: c.bg.elevated,
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${c.border.default}`,
          background: c.bg.secondary,
          fontSize: 11,
          color: c.text.secondary,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            padding: '1px 6px',
            background: c.status.error + '22',
            border: `1px solid ${c.status.error}44`,
            borderRadius: 10,
            color: c.status.error,
          }}
        >
          conflict
        </span>
        <span style={{ fontFamily: 'monospace', color: c.text.primary }}>{conflict.relativePath}</span>
      </div>

      {/* Side-by-side panes */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
        {/* Mine */}
        <div
          style={{
            borderRight: `1px solid ${c.border.default}`,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 11, color: c.text.secondary, marginBottom: 8 }}>
            <strong style={{ color: c.text.primary }}>{conflict.localMachineName}</strong> (this machine)
            <span style={{ display: 'block', color: c.text.disabled, marginTop: 2 }}>{localDate}</span>
          </div>
          <pre
            style={{
              fontSize: 11,
              color: c.text.primary,
              background: c.bg.primary,
              padding: 10,
              borderRadius: 4,
              overflow: 'auto',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {conflict.localContent ?? '(binary file — cannot preview)'}
          </pre>
          <button
            onClick={onKeepMine}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '6px 0',
              borderRadius: 4,
              border: `1px solid ${c.accent.primary}`,
              background: 'transparent',
              color: c.accent.primary,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Keep Mine
          </button>
        </div>

        {/* Theirs */}
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 11, color: c.text.secondary, marginBottom: 8 }}>
            <strong style={{ color: c.text.primary }}>{remoteMachines}</strong>
            <span style={{ display: 'block', color: c.text.disabled, marginTop: 2 }}>{remoteDate}</span>
          </div>
          <pre
            style={{
              fontSize: 11,
              color: c.text.primary,
              background: c.bg.primary,
              padding: 10,
              borderRadius: 4,
              overflow: 'auto',
              maxHeight: 200,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {conflict.remoteContent ?? '(binary file — cannot preview)'}
          </pre>
          <button
            onClick={onUseTheirs}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '6px 0',
              borderRadius: 4,
              border: 'none',
              background: c.accent.primary,
              color: '#fff',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Use Theirs
          </button>
        </div>
      </div>
    </div>
  );
}
