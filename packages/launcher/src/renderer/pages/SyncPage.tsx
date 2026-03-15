import React, { useState, useEffect } from 'react';
import { useSyncStatus } from '../hooks/useSyncStatus.js';
import { useIpc } from '../hooks/useIpc.js';
import { QueueSummary } from '../components/QueueSummary.js';
import { c } from '../styles.js';

export function SyncPage(): React.ReactElement {
  const { status, queue, syncLog, runSync, flushQueue } = useSyncStatus();
  const ipc = useIpc();
  const [syncSourcePath, setSyncSourcePath] = useState('');

  useEffect(() => {
    ipc.config.get().then(cfg => setSyncSourcePath(cfg.syncSourcePath));
  }, [ipc]);

  const browseSyncSource = async () => {
    const picked = await ipc.dialog.openFolder();
    if (picked) {
      await ipc.config.setSyncSourcePath(picked);
      setSyncSourcePath(picked);
    }
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Sync</h2>

      {/* Sync source */}
      <Section title="Sync Source">
        <p style={{ color: c.text.secondary, fontSize: 12, marginBottom: 10 }}>
          Point to any mounted folder: Dropbox, NAS, USB, or local path.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={syncSourcePath}
            readOnly
            placeholder="No sync source configured"
            style={{
              flex: 1,
              background: c.bg.secondary,
              border: `1px solid ${c.border.default}`,
              borderRadius: 4,
              color: c.text.primary,
              padding: '6px 10px',
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button onClick={browseSyncSource} style={secondaryBtn}>Browse</button>
        </div>
      </Section>

      {/* Status */}
      <Section title="Status">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Row label="State" value={status.state === 'syncing' ? 'Syncing…' : status.state} />
          {status.lastSyncedAt && (
            <Row label="Last synced" value={new Date(status.lastSyncedAt).toLocaleString()} />
          )}
          {status.lastSyncMachine && (
            <Row label="Machine" value={status.lastSyncMachine} />
          )}
          {status.lastSyncSummary && status.state !== 'syncing' && (
            <Row label="Result" value={status.lastSyncSummary} />
          )}
          {status.pendingCount > 0 && (
            <Row label="Pending changes" value={String(status.pendingCount)} />
          )}
          {status.conflictCount > 0 && (
            <Row label="Conflicts" value={String(status.conflictCount)} />
          )}
          {status.errorMessage && (
            <p style={{ color: c.status.error, fontSize: 12, marginTop: 4 }}>{status.errorMessage}</p>
          )}
        </div>
        <button
          onClick={runSync}
          disabled={status.state === 'syncing'}
          style={{ ...primaryBtn, marginTop: 14 }}
        >
          {status.state === 'syncing' ? 'Syncing…' : 'Sync Now'}
        </button>
      </Section>

      {/* Offline queue */}
      {queue.length > 0 && (
        <Section title="Offline Queue">
          <QueueSummary queue={queue} onFlush={flushQueue} />
        </Section>
      )}

      {/* Sync Log */}
      {syncLog.length > 0 && (
        <Section title="Sync Log">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {syncLog.map((entry, i) => (
              <div
                key={entry.timestamp + i}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 0',
                  borderBottom: i < syncLog.length - 1 ? `1px solid ${c.border.default}` : undefined,
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: c.text.primary }}>
                    {entry.machineName}
                  </span>
                  <span style={{ fontSize: 11, color: c.text.disabled }}>
                    {entry.summary}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: c.text.disabled, flexShrink: 0 }}>
                  {formatRelativeTime(entry.timestamp)}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ color: c.text.secondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
        {title}
      </h3>
      <div
        style={{
          background: c.bg.elevated,
          border: `1px solid ${c.border.default}`,
          borderRadius: 6,
          padding: '14px 16px',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
      <span style={{ color: c.text.secondary }}>{label}</span>
      <span style={{ color: c.text.primary }}>{value}</span>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  padding: '6px 16px',
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
