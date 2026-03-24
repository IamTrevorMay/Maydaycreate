import React, { useState, useEffect } from 'react';
import { MarketplacePage } from './pages/MarketplacePage.js';
import { SyncPage } from './pages/SyncPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { YouTubePage } from './pages/YouTubePage.js';
import { CuttingBoardPage } from './pages/CuttingBoardPage.js';
import { SyncStatusBar } from './components/SyncStatusBar.js';
import { ServerStatusIndicator } from './components/ServerStatusIndicator.js';
import { useSyncStatus } from './hooks/useSyncStatus.js';
import { useIpc } from './hooks/useIpc.js';
import { useAnalysisProgress } from './hooks/useAnalysisProgress.js';
import type { ServerStatus, AnalysisProgress as AnalysisProgressType } from '@mayday/types';
import { c } from './styles.js';
import {
  PluginUIRegistryProvider,
  usePluginUIRegistry,
  registerPageComponent,
} from './plugin-ui-registry.js';
import type { SidebarEntry } from './plugin-ui-registry.js';

// ── Register core page components ──────────────────────────────────────────────
// Maps page IDs from the registry to their React components.

registerPageComponent('marketplace', MarketplacePage);
registerPageComponent('sync', SyncPage);
registerPageComponent('settings', SettingsPage);

// Core plugins — code still lives in the renderer, sidebar entry comes from plugin manifest
registerPageComponent('analyzer', YouTubePage);
registerPageComponent('cutting-board', CuttingBoardPage);

// ── App (outer wrapper with provider) ──────────────────────────────────────────

export default function App(): React.ReactElement {
  return (
    <PluginUIRegistryProvider>
      <AppInner />
    </PluginUIRegistryProvider>
  );
}

// ── AppInner (consumes registry context) ───────────────────────────────────────

type AutoUpdateState = 'idle' | 'checking' | 'updating' | 'ready' | 'error';

function AppInner(): React.ReactElement {
  const [page, setPage] = useState('marketplace');
  const { status, runSync } = useSyncStatus();
  const ipc = useIpc();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const analysisProgress = useAnalysisProgress();
  const [updateState, setUpdateState] = useState<AutoUpdateState>('idle');
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const registry = usePluginUIRegistry();

  // Poll server status on mount and subscribe to push updates
  useEffect(() => {
    const poll = () => ipc.server.getStatus().then(setServerStatus);
    poll();
    const interval = setInterval(poll, 2000);
    const unsub = ipc.server.onStatus(setServerStatus);
    return () => { clearInterval(interval); unsub(); };
  }, [ipc]);

  // Tray sync trigger
  useEffect(() => {
    const unsub = ipc.tray.onSync(runSync);
    return unsub;
  }, [ipc, runSync]);

  // Auto-update status listener
  useEffect(() => {
    const unsub = ipc.app.onAutoUpdateStatus((status) => {
      setUpdateState(status.state as AutoUpdateState);
      if (status.state === 'ready') setBannerDismissed(false);
    });
    return unsub;
  }, [ipc]);

  // Inject dynamic badge for conflicts
  const sidebarEntries = registry.sidebarEntries.map((entry) => {
    if (entry.id === 'conflicts' && status.conflictCount > 0) {
      return { ...entry, badge: status.conflictCount };
    }
    return entry;
  });

  // Split into core and plugin entries for separator rendering
  const coreEntries = sidebarEntries.filter((e) => e.type === 'core');
  const pluginEntries = sidebarEntries.filter((e) => e.type === 'plugin');

  // Resolve page component
  const PageComponent = registry.getPageComponent(page);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar (draggable traffic-light area + server status) */}
      <div
        style={{
          height: 38,
          background: '#1a1a1a',
          borderBottom: `1px solid ${c.border.default}`,
          display: 'flex',
          alignItems: 'center',
          WebkitAppRegion: 'drag',
          flexShrink: 0,
        } as React.CSSProperties}
      >
        <div style={{ WebkitAppRegion: 'no-drag', marginLeft: 80 } as React.CSSProperties}>
          <ServerStatusIndicator status={serverStatus} />
        </div>
      </div>

      {/* Sync status bar */}
      <SyncStatusBar status={status} onSyncNow={runSync} />

      {/* Auto-update banners */}
      {updateState === 'updating' && (
        <div style={{ background: '#1e3a5f', padding: '6px 16px', fontSize: 11, color: '#93c5fd', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#60a5fa', animation: 'pulse 1.5s ease-in-out infinite' }} />
          Updating in background...
          <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        </div>
      )}
      {updateState === 'ready' && !bannerDismissed && (
        <div style={{ background: '#14532d', padding: '6px 16px', fontSize: 11, color: '#86efac', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span>Update ready — restart to apply</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => ipc.app.relaunch()}
              style={{ padding: '2px 10px', borderRadius: 3, border: 'none', fontSize: 11, cursor: 'pointer', background: '#4ade80', color: '#000', fontWeight: 600 }}
            >
              Restart Now
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{ padding: '2px 10px', borderRadius: 3, border: '1px solid #4ade8066', fontSize: 11, cursor: 'pointer', background: 'transparent', color: '#86efac' }}
            >
              Later
            </button>
          </div>
        </div>
      )}

      {/* Main layout: nav + content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left navigation */}
        <nav
          style={{
            width: 140,
            background: c.bg.secondary,
            borderRight: `1px solid ${c.border.default}`,
            display: 'flex',
            flexDirection: 'column',
            padding: '12px 0',
            flexShrink: 0,
          }}
        >
          {coreEntries.map(item => (
            <NavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => setPage(item.id)}
            />
          ))}

          {/* Separator between core and plugin entries */}
          {pluginEntries.length > 0 && (
            <div style={{
              height: 1,
              background: c.border.default,
              margin: '8px 16px',
            }} />
          )}

          {pluginEntries.map(item => (
            <NavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => setPage(item.id)}
            />
          ))}

          {page !== 'analyzer' && analysisProgress && analysisProgress.status !== 'complete' && analysisProgress.status !== 'error' && analysisProgress.status !== 'cancelled' && (
            <MiniAnalysisIndicator progress={analysisProgress} onClick={() => setPage('analyzer')} />
          )}
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'auto', background: c.bg.primary }}>
          {PageComponent ? <PageComponent /> : <MarketplacePage />}
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function MiniAnalysisIndicator({ progress, onClick }: { progress: AnalysisProgressType; onClick: () => void }): React.ReactElement {
  const isPaused = progress.status === 'paused';
  const dotColor = isPaused ? c.status.warning : c.accent.primary;

  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 'auto',
        padding: '8px 12px',
        background: c.bg.elevated,
        border: 'none',
        borderTop: `1px solid ${c.border.default}`,
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
      }}
    >
      <div style={{
        height: 3,
        background: c.bg.tertiary,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 6,
      }}>
        <div style={{
          height: '100%',
          width: `${progress.percent}%`,
          background: isPaused ? c.status.warning : c.accent.primary,
          borderRadius: 2,
          transition: 'width 0.3s',
        }} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor,
          display: 'inline-block',
          flexShrink: 0,
          animation: isPaused ? 'none' : 'pulse 1.5s ease-in-out infinite',
        }} />
        <span style={{ color: c.text.secondary, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isPaused ? 'Paused' : progress.phase} {progress.percent > 0 ? `${progress.percent}%` : ''}
        </span>
      </div>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </button>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: SidebarEntry;
  active: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 16px',
        background: active ? c.bg.elevated : 'transparent',
        border: 'none',
        borderLeft: `3px solid ${active ? c.accent.primary : 'transparent'}`,
        color: active ? c.text.primary : c.text.secondary,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      <span>{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span
          style={{
            background: c.status.error,
            color: '#fff',
            borderRadius: 10,
            fontSize: 10,
            padding: '0 5px',
            minWidth: 16,
            textAlign: 'center',
          }}
        >
          {item.badge}
        </span>
      )}
    </button>
  );
}
