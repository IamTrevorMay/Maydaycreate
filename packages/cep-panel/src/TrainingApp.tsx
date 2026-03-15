import React from 'react';
import { useTrainingWebSocket } from './bridge/training-websocket.js';
import { TrainingDashboard } from './panels/TrainingDashboard.js';

export function TrainingApp() {
  const ws = useTrainingWebSocket();

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
        <span style={{ fontWeight: 600, fontSize: 13 }}>Mayday Training</span>
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
      <TrainingDashboard
        connected={ws.connected}
        send={ws.send}
        onMessage={ws.onMessage}
      />
    </div>
  );
}
