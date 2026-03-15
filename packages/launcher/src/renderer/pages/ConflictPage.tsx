import React from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import { ConflictDiff } from '../components/ConflictDiff.js';
import { c } from '../styles.js';

export function ConflictPage(): React.ReactElement {
  const { conflicts, resolveConflict } = useSyncStatus();

  if (conflicts.length === 0) {
    return (
      <div style={{ padding: '20px 24px' }}>
        <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Conflicts</h2>
        <div
          style={{
            background: c.bg.elevated,
            border: `1px solid ${c.border.default}`,
            borderRadius: 6,
            padding: 24,
            textAlign: 'center',
            color: c.text.secondary,
            fontSize: 13,
          }}
        >
          No conflicts — everything is in sync.
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Conflicts</h2>
        <p style={{ color: c.text.secondary, fontSize: 12, marginTop: 4 }}>
          {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''} need resolution
        </p>
      </div>

      {conflicts.map(conflict => (
        <ConflictDiff
          key={conflict.relativePath}
          conflict={conflict}
          onKeepMine={() => resolveConflict(conflict.relativePath, 'keep-mine')}
          onUseTheirs={() => resolveConflict(conflict.relativePath, 'use-theirs')}
        />
      ))}
    </div>
  );
}
