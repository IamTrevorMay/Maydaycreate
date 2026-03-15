import React, { useState } from 'react';
import { useIpc } from '../hooks/useIpc.js';
import { usePlugins } from '../hooks/usePlugins.js';
import { c } from '../styles.js';

type InstallState = 'idle' | 'installing' | 'success' | 'error';

export function InstallerPage(): React.ReactElement {
  const ipc = useIpc();
  const { install } = usePlugins();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [state, setState] = useState<InstallState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [installedName, setInstalledName] = useState('');

  const browse = async () => {
    const p = await ipc.dialog.openPlugin();
    if (p) {
      setSelectedPath(p);
      setState('idle');
      setErrorMsg('');
    }
  };

  const handleInstall = async () => {
    if (!selectedPath) return;
    setState('installing');
    setErrorMsg('');
    try {
      const manifest = await install(selectedPath) as { name: string } | undefined;
      setInstalledName((manifest as any)?.name ?? selectedPath);
      setState('success');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Install Plugin</h2>

      <div
        style={{
          background: c.bg.elevated,
          border: `1px solid ${c.border.default}`,
          borderRadius: 6,
          padding: '20px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <p style={{ color: c.text.secondary, fontSize: 12 }}>
          Select a plugin folder. It must contain a valid <code style={{ color: c.text.primary }}>mayday.json</code> manifest.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div
            style={{
              flex: 1,
              background: c.bg.secondary,
              border: `1px solid ${c.border.default}`,
              borderRadius: 4,
              padding: '6px 10px',
              fontSize: 12,
              color: selectedPath ? c.text.primary : c.text.disabled,
            }}
          >
            {selectedPath ?? 'No folder selected'}
          </div>
          <button onClick={browse} style={secondaryBtn}>Browse</button>
        </div>

        {state === 'success' && (
          <p style={{ color: c.status.success, fontSize: 12 }}>
            "{installedName}" installed and activated successfully.
          </p>
        )}

        {state === 'error' && (
          <p style={{ color: c.status.error, fontSize: 12 }}>
            {errorMsg}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={handleInstall}
            disabled={!selectedPath || state === 'installing'}
            style={{
              ...primaryBtn,
              opacity: !selectedPath || state === 'installing' ? 0.5 : 1,
              cursor: !selectedPath || state === 'installing' ? 'not-allowed' : 'pointer',
            }}
          >
            {state === 'installing' ? 'Installing…' : 'Install Plugin'}
          </button>
        </div>
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
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};
