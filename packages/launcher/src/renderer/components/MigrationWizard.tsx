import React, { useState, useEffect } from 'react';
import { useIpc } from '../hooks/useIpc.js';
import type { MigrationProgress } from '@mayday/sync-engine';
import { c } from '../styles.js';

interface Props {
  currentPath: string;
  onDone: (newPath: string) => void;
  onCancel: () => void;
}

type Step = 'choose' | 'confirm' | 'progress' | 'done';

export function MigrationWizard({ currentPath, onDone, onCancel }: Props): React.ReactElement {
  const ipc = useIpc();
  const [step, setStep] = useState<Step>('choose');
  const [newPath, setNewPath] = useState('');
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = ipc.config.onMigrationProgress((p) => {
      setProgress(p);
      if (p.phase === 'done') setStep('done');
      if (p.phase === 'error') setError(p.errorMessage ?? 'Unknown error');
    });
    return unsub;
  }, [ipc]);

  const browseFolder = async () => {
    const picked = await ipc.dialog.openFolder();
    if (picked) setNewPath(picked);
  };

  const startMigration = async () => {
    setStep('progress');
    setError(null);
    try {
      await ipc.config.migrateSyncSource(currentPath, newPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const pct = progress && progress.filesTotal > 0
    ? Math.round((progress.filesDone / progress.filesTotal) * 100)
    : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#0009',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: c.bg.elevated,
          border: `1px solid ${c.border.default}`,
          borderRadius: 8,
          padding: 28,
          width: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h3 style={{ color: c.text.primary, fontSize: 15, fontWeight: 600 }}>
          Move Sync Source
        </h3>

        {step === 'choose' && (
          <>
            <p style={{ color: c.text.secondary, fontSize: 12 }}>
              Current: <code style={{ color: c.text.primary }}>{currentPath || '(not set)'}</code>
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                placeholder="New sync folder path…"
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
              <button onClick={browseFolder} style={secondaryBtn}>Browse</button>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onCancel} style={secondaryBtn}>Cancel</button>
              <button
                onClick={() => setStep('confirm')}
                disabled={!newPath}
                style={{ ...primaryBtn, opacity: newPath ? 1 : 0.5 }}
              >
                Next
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            <p style={{ color: c.text.secondary, fontSize: 12 }}>
              All files will be copied from{' '}
              <code style={{ color: c.text.primary }}>{currentPath}</code> to{' '}
              <code style={{ color: c.text.primary }}>{newPath}</code> and hashes verified before switching.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setStep('choose')} style={secondaryBtn}>Back</button>
              <button onClick={startMigration} style={primaryBtn}>Start Migration</button>
            </div>
          </>
        )}

        {step === 'progress' && (
          <>
            <p style={{ color: c.text.secondary, fontSize: 12, textTransform: 'capitalize' }}>
              {progress?.phase ?? 'Preparing'}…
            </p>
            <div
              style={{
                height: 8,
                background: c.bg.secondary,
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: c.accent.primary,
                  borderRadius: 4,
                  transition: 'width 0.2s',
                }}
              />
            </div>
            <p style={{ color: c.text.disabled, fontSize: 11 }}>
              {progress ? `${progress.filesDone} / ${progress.filesTotal} files` : ''}
            </p>
            {error && <p style={{ color: c.status.error, fontSize: 12 }}>{error}</p>}
          </>
        )}

        {step === 'done' && (
          <>
            <p style={{ color: c.status.success, fontSize: 13 }}>
              Migration complete!
            </p>
            <p style={{ color: c.text.secondary, fontSize: 12 }}>
              Sync source is now at <code style={{ color: c.text.primary }}>{newPath}</code>
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => onDone(newPath)} style={primaryBtn}>Done</button>
            </div>
          </>
        )}
      </div>
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
  padding: '6px 16px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};
