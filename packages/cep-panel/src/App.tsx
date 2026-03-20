import React from 'react';
import { PluginManager } from './panels/PluginManager.js';
import { useWebSocket } from './bridge/websocket.js';
import { CutFeedbackWidget } from './components/CutFeedbackWidget.js';
import { VideoIdBar } from './components/VideoIdBar.js';
import { AgentPanel } from './components/AgentPanel.js';
import { PresetVaultPanel } from './components/PresetVaultPanel.js';

export function App() {
  const { connected, serverStatus, send, onMessage } = useWebSocket();

  return (
    <div style={{ padding: 8, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        borderBottom: '1px solid #333',
        marginBottom: 8,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Mayday Create</span>
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          background: connected ? '#1b4332' : '#442222',
          color: connected ? '#4ade80' : '#f87171',
        }}>
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>
      <main style={{ flex: 1, overflow: 'auto' }}>
        <PluginManager />
        <PresetVaultPanel onMessage={onMessage} />
        <AgentPanel onMessage={onMessage} send={send} />
      </main>
      <VideoIdBar send={send} />
      <CutFeedbackWidget onMessage={onMessage} send={send} />
    </div>
  );
}
