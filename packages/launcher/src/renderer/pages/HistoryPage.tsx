import React, { useState } from 'react';
import { useHistory } from '../hooks/useHistory.js';
import { HistorySnapshotRow } from '../components/HistorySnapshot.js';
import type { HistorySnapshot } from '@mayday/sync-engine';
import { c } from '../styles.js';

export function HistoryPage(): React.ReactElement {
  const { snapshots, loading, createSnapshot, restore } = useHistory();
  const [confirmTarget, setConfirmTarget] = useState<HistorySnapshot | null>(null);

  const handleRestore = async () => {
    if (!confirmTarget) return;
    await restore(confirmTarget);
    setConfirmTarget(null);
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>History</h2>
        <button onClick={createSnapshot} style={primaryBtn}>
          Create Snapshot
        </button>
      </div>

      <div
        style={{
          background: c.bg.elevated,
          border: `1px solid ${c.border.default}`,
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        {loading && (
          <div style={{ padding: 20, color: c.text.disabled, fontSize: 13 }}>Loading…</div>
        )}
        {!loading && snapshots.length === 0 && (
          <div style={{ padding: 20, color: c.text.secondary, fontSize: 13, textAlign: 'center' }}>
            No snapshots yet. Create one before making changes.
          </div>
        )}
        {snapshots.map(s => (
          <HistorySnapshotRow key={s.id} snapshot={s} onRestore={setConfirmTarget} />
        ))}
      </div>

      {/* Restore confirmation modal */}
      {confirmTarget && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#0008',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              background: c.bg.elevated,
              border: `1px solid ${c.border.default}`,
              borderRadius: 8,
              padding: 28,
              width: 400,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <h3 style={{ color: c.text.primary, fontSize: 15 }}>Restore Snapshot?</h3>
            <p style={{ color: c.text.secondary, fontSize: 12 }}>
              This will overwrite your current sync configs with the snapshot from{' '}
              <strong style={{ color: c.text.primary }}>
                {new Date(confirmTarget.timestamp).toLocaleString()}
              </strong>. A backup will be created automatically.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmTarget(null)} style={secondaryBtn}>
                Cancel
              </button>
              <button onClick={handleRestore} style={dangerBtn}>
                Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: 'none',
  background: '#2680eb',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};

const dangerBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: 'none',
  background: '#f87171',
  color: '#fff',
  fontSize: 12,
  cursor: 'pointer',
};
