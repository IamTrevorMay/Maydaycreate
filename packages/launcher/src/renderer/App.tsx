import React, { useState, useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage.js';
import { SyncPage } from './pages/SyncPage.js';
import { ConflictPage } from './pages/ConflictPage.js';
import { HistoryPage } from './pages/HistoryPage.js';
import { InstallerPage } from './pages/InstallerPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { YouTubePage } from './pages/YouTubePage.js';
import { SyncStatusBar } from './components/SyncStatusBar.js';
import { ServerStatusIndicator } from './components/ServerStatusIndicator.js';
import { useSyncStatus } from './hooks/useSyncStatus.js';
import { useIpc } from './hooks/useIpc.js';
import type { ServerStatus } from '@mayday/types';
import { c } from './styles.js';

type Page = 'dashboard' | 'sync' | 'conflicts' | 'history' | 'installer' | 'youtube' | 'settings';

interface NavItem {
  id: Page;
  label: string;
  badge?: number;
}

export default function App(): React.ReactElement {
  const [page, setPage] = useState<Page>('dashboard');
  const { status, runSync } = useSyncStatus();
  const ipc = useIpc();
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);

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

  const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Plugins' },
    { id: 'sync', label: 'Sync' },
    { id: 'conflicts', label: 'Conflicts', badge: status.conflictCount || undefined },
    { id: 'history', label: 'History' },
    { id: 'installer', label: 'Install' },
    { id: 'youtube', label: 'YouTube' },
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
        </nav>

        {/* Content area */}
        <main style={{ flex: 1, overflow: 'auto', background: c.bg.primary }}>
          {page === 'dashboard' && <DashboardPage />}
          {page === 'sync' && <SyncPage />}
          {page === 'conflicts' && <ConflictPage />}
          {page === 'history' && <HistoryPage />}
          {page === 'installer' && <InstallerPage />}
          {page === 'youtube' && <YouTubePage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
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
