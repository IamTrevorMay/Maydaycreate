import React, { useState, useEffect } from 'react';
import { useIpc } from '../hooks/useIpc.js';
import { MigrationWizard } from '../components/MigrationWizard.js';
import { UpdateWizard } from '../components/UpdateWizard.js';
import type { LauncherConfig } from '../../main/config-store.js';
import { c } from '../styles.js';

export function SettingsPage(): React.ReactElement {
  const ipc = useIpc();
  const [config, setConfig] = useState<LauncherConfig | null>(null);
  const [showMigration, setShowMigration] = useState(false);
  const [showUpdateWizard, setShowUpdateWizard] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [apiKeyError, setApiKeyError] = useState('');
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [appVersion, setAppVersion] = useState('…');
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'up-to-date' | 'available' | 'error'>('idle');
  const [updateInfo, setUpdateInfo] = useState<{ commitsBehind: number; currentCommit: string; latestCommit: string } | null>(null);

  useEffect(() => {
    ipc.config.get().then((cfg) => {
      setConfig(cfg);
      if (cfg.anthropicApiKey) {
        setHasStoredKey(true);
        setApiKey('');
      }
    });
    ipc.app.getVersion().then((info) => setAppVersion(info.version));
  }, [ipc]);

  const checkForUpdates = async () => {
    setUpdateStatus('checking');
    try {
      const result = await ipc.app.checkForUpdates();
      setUpdateInfo(result);
      setUpdateStatus(result.updateAvailable ? 'available' : 'up-to-date');
    } catch {
      setUpdateStatus('error');
    }
  };

  const toggleAutoLaunch = async () => {
    if (!config) return;
    const updated = await ipc.config.setAutoLaunch(!config.autoLaunchOnLogin);
    setConfig(updated);
  };

  const saveApiKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setApiKeyStatus('saving');
    try {
      console.log('[Settings] Saving API key, length:', trimmed.length);
      console.log('[Settings] ipc.config methods:', Object.keys(ipc.config));
      const updated = await ipc.config.setAnthropicApiKey(trimmed);
      console.log('[Settings] Save result:', updated ? 'ok' : 'empty');
      setConfig(updated);
      setHasStoredKey(true);
      setApiKey('');
      setApiKeyStatus('saved');
      setTimeout(() => setApiKeyStatus('idle'), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Settings] Failed to save API key:', msg);
      setApiKeyError(msg);
      setApiKeyStatus('error');
      setTimeout(() => setApiKeyStatus('idle'), 5000);
    }
  };

  const clearApiKey = async () => {
    try {
      const updated = await ipc.config.setAnthropicApiKey('');
      setConfig(updated);
      setHasStoredKey(false);
      setApiKey('');
      setApiKeyStatus('idle');
    } catch (err) {
      console.error('Failed to clear API key:', err);
    }
  };

  const handleMigrationDone = async (_newPath: string) => {
    setShowMigration(false);
    const updated = await ipc.config.get();
    setConfig(updated);
  };

  if (!config) {
    return <div style={{ padding: 24, color: c.text.disabled }}>Loading…</div>;
  }

  return (
    <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Settings</h2>

      {/* Sync source */}
      <Section title="Sync Source">
        <Row
          label="Path"
          value={config.syncSourcePath || 'Not configured'}
        />
        <Row label="Machine ID" value={config.machineId} mono />
        <Row label="Machine Name" value={config.machineName} />
        <button
          onClick={() => setShowMigration(true)}
          style={{ ...secondaryBtn, marginTop: 12 }}
        >
          Move Sync Source…
        </button>
      </Section>

      {/* Server */}
      <Section title="Server">
        <Row label="Port" value={String(config.serverPort)} />
      </Section>

      {/* Startup */}
      <Section title="Startup">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, color: c.text.primary }}>Launch at login</span>
          <button
            onClick={toggleAutoLaunch}
            style={{
              padding: '3px 10px',
              borderRadius: 4,
              border: 'none',
              fontSize: 11,
              cursor: 'pointer',
              background: config.autoLaunchOnLogin ? '#2680eb' : '#383838',
              color: config.autoLaunchOnLogin ? '#fff' : '#999',
            }}
          >
            {config.autoLaunchOnLogin ? 'Enabled' : 'Disabled'}
          </button>
        </div>
      </Section>

      {/* Updates */}
      <Section title="Updates">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: c.text.primary }}>Current version: {appVersion}</span>
            <button
              onClick={checkForUpdates}
              disabled={updateStatus === 'checking'}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                border: 'none',
                fontSize: 11,
                cursor: updateStatus === 'checking' ? 'default' : 'pointer',
                background: c.accent.primary,
                color: '#fff',
                opacity: updateStatus === 'checking' ? 0.6 : 1,
              }}
            >
              {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
            </button>
          </div>
          {updateStatus === 'up-to-date' && (
            <span style={{ fontSize: 11, color: c.status.success }}>Up to date ({updateInfo?.currentCommit})</span>
          )}
          {updateStatus === 'available' && updateInfo && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, color: c.status.warning }}>
                Update available — {updateInfo.commitsBehind} commit{updateInfo.commitsBehind !== 1 ? 's' : ''} behind ({updateInfo.currentCommit} → {updateInfo.latestCommit})
              </span>
              <button
                onClick={() => setShowUpdateWizard(true)}
                style={{
                  padding: '5px 14px',
                  borderRadius: 4,
                  border: 'none',
                  fontSize: 11,
                  cursor: 'pointer',
                  background: c.status.warning,
                  color: '#000',
                  fontWeight: 600,
                  alignSelf: 'flex-start',
                }}
              >
                Install Update
              </button>
            </div>
          )}
          {updateStatus === 'error' && (
            <span style={{ fontSize: 11, color: c.status.error }}>Failed to check for updates</span>
          )}
        </div>
      </Section>

      {/* API Keys */}
      <Section title="API Keys">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: c.text.secondary }}>Anthropic API Key</span>
            {hasStoredKey && apiKeyStatus !== 'saved' && (
              <span style={{ fontSize: 10, color: c.status.success, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.status.success, display: 'inline-block' }} />
                Configured
              </span>
            )}
            {apiKeyStatus === 'saved' && (
              <span style={{ fontSize: 10, color: c.status.success }}>Key saved successfully</span>
            )}
            {apiKeyStatus === 'error' && (
              <span style={{ fontSize: 10, color: c.status.error }}>Failed: {apiKeyError}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setApiKeyStatus('idle'); }}
              placeholder={hasStoredKey ? 'Enter new key to replace...' : 'sk-ant-api03-...'}
              style={{
                flex: 1,
                padding: '6px 10px',
                borderRadius: 4,
                border: `1px solid ${apiKeyStatus === 'error' ? c.status.error : c.border.default}`,
                background: c.bg.primary,
                color: c.text.primary,
                fontSize: 12,
                fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={saveApiKey}
              disabled={!apiKey.trim() || apiKeyStatus === 'saving'}
              style={{
                padding: '6px 14px',
                borderRadius: 4,
                border: 'none',
                fontSize: 11,
                cursor: apiKey.trim() ? 'pointer' : 'default',
                background: apiKeyStatus === 'saving' ? '#555' : c.accent.primary,
                color: '#fff',
                opacity: apiKey.trim() ? 1 : 0.5,
              }}
            >
              {apiKeyStatus === 'saving' ? 'Saving...' : 'Save'}
            </button>
            {hasStoredKey && (
              <button
                onClick={clearApiKey}
                style={{
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: `1px solid ${c.border.default}`,
                  background: 'transparent',
                  fontSize: 11,
                  cursor: 'pointer',
                  color: c.text.secondary,
                }}
              >
                Clear
              </button>
            )}
          </div>
          <span style={{ fontSize: 10, color: c.text.disabled }}>
            Required for YouTube video analysis. Get yours at console.anthropic.com
          </span>
        </div>
      </Section>

      {/* Source Repository */}
      <Section title="Source Repository">
        <Row label="Path" value={config.sourceRepoPath || 'Not configured'} mono />
      </Section>

      {/* About */}
      <Section title="About">
        <Row label="App" value="Mayday Create" />
        <Row label="Version" value={appVersion} />
      </Section>

      {showMigration && (
        <MigrationWizard
          currentPath={config.syncSourcePath}
          onDone={handleMigrationDone}
          onCancel={() => setShowMigration(false)}
        />
      )}

      {showUpdateWizard && updateInfo && (
        <UpdateWizard
          commitsBehind={updateInfo.commitsBehind}
          currentCommit={updateInfo.currentCommit}
          latestCommit={updateInfo.latestCommit}
          onDone={() => setShowUpdateWizard(false)}
          onCancel={() => setShowUpdateWizard(false)}
        />
      )}
    </div>
  );
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
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 12 }}>
      <span style={{ color: c.text.secondary, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: c.text.primary,
          fontFamily: mono ? 'monospace' : undefined,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};
