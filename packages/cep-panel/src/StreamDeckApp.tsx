import React from 'react';
import { useStreamDeckWebSocket } from './bridge/streamdeck-websocket.js';
import { StreamDeckGrid } from './panels/StreamDeckGrid.js';

export function StreamDeckApp() {
  const ws = useStreamDeckWebSocket();

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
        <span style={{ fontWeight: 600, fontSize: 13 }}>Stream Deck</span>
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 3,
          background: ws.connected ? '#1b4332' : '#442222',
          color: ws.connected ? '#4ade80' : '#f87171',
        }}>
          {ws.connected ? 'Connected' : 'Disconnected'}
        </span>
      </header>
      <StreamDeckGrid
        connected={ws.connected}
        send={ws.send}
        onMessage={ws.onMessage}
      />
    </div>
  );
}
