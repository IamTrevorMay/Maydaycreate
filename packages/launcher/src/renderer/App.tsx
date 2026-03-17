import React, { useState, useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage.js';
import { SyncPage } from './pages/SyncPage.js';
import { ConflictPage } from './pages/ConflictPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { InstallerPage } from './pages/InstallerPage.js';
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

type Page = 'dashboard' | 'sync' | 'conflicts' | 'history' | 'installer' | 'youtube' | 'cutting-board' | 'settings';

interface NavItem {
  id: Page;
  label: string;
  badge?: number;
}

type AutoUpdateState = 'idle' | 'checking' | 'updating' | 'ready' | 'error';

export default function App(): React.ReactElement {
  const [page, setPage] = useState<Page>('dashboard');
  const { status, runSync } = useSyncStatus();
  const ipc = useIpc();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const analysisProgress = useAnalysisProgress();
  const [updateState, setUpdateState] = useState<AutoUpdateState>('idle');
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Poll server status on mount and subscribe to push updates
  useEffect(() => {
    const poll = () => ipc.server.getStatus().then(setServerStatus);
    poll();
    // Poll every 2s until online, then rely on push events (emitted every 5s from main)
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

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Plugins' },
    { id: 'sync', label: 'Sync' },
    { id: 'conflicts', label: 'Conflicts', badge: status.conflictCount || undefined },
    { id: 'history', label: 'History' },
    { id: 'installer', label: 'Install' },
    { id: 'youtube', label: 'Analyzer' },
    { id: 'cutting-board', label: 'Cutting Board' },
    { id: 'settings', label: 'Settings' },
  ];

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
        {/* Non-draggable server status */}
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
          {navItems.map(item => (
            <NavButton
              key={item.id}
              item={item}
              active={page === item.id}
              onClick={() => setPage(item.id)}
            />
          ))}
          {page !== 'youtube' && analysisProgress && analysisProgress.status !== 'complete' && analysisProgress.status !== 'error' && analysisProgress.status !== 'cancelled' && (
            <MiniAnalysisIndicator progress={analysisProgress} onClick={() => setPage('youtube')} />
          )}
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'auto', background: c.bg.primary }}>
          {page === 'dashboard' && <DashboardPage />}
          {page === 'sync' && <SyncPage />}
          {page === 'conflicts' && <ConflictPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'installer' && <InstallerPage />}
          {page === 'youtube' && <YouTubePage />}
          {page === 'cutting-board' && <CuttingBoardPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

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
      {/* Progress bar */}
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
      {/* Status line */}
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
  item: NavItem;
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
