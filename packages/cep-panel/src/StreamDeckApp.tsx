import React, { useState, useEffect, useCallback } from 'react';
import { useStreamDeckWebSocket } from './bridge/streamdeck-websocket.js';
import { StreamDeckGrid } from './panels/StreamDeckGrid.js';
import type { BridgeMessage } from '@mayday/types';

export function StreamDeckApp() {
  const ws = useStreamDeckWebSocket();
  const [hwConnected, setHwConnected] = useState(false);
  const [mode, setMode] = useState<'editing' | 'training'>('editing');

  // Request hardware status and mode on websocket connect
  useEffect(() => {
    if (!ws.connected) return;
    ws.send({
      id: crypto.randomUUID(),
      type: 'streamdeck:get-status' as any,
      payload: {},
      timestamp: Date.now(),
    });
    ws.send({
      id: crypto.randomUUID(),
      type: 'streamdeck:get-mode' as any,
      payload: {},
      timestamp: Date.now(),
    });
  }, [ws.connected, ws.send]);

  // Listen for hardware status updates and mode changes
  useEffect(() => {
    const unsubs = [
      ws.onMessage('streamdeck:status-data', (payload) => {
        const data = payload as { connected: boolean };
        setHwConnected(data.connected);
      }),
      ws.onMessage('streamdeck:mode-changed', (payload) => {
        const data = payload as { mode: 'editing' | 'training' };
        setMode(data.mode);
      }),
      ws.onMessage('streamdeck:mode-data', (payload) => {
        const data = payload as { mode: 'editing' | 'training' };
        setMode(data.mode);
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [ws.onMessage]);

  const handleDisconnectToggle = useCallback(() => {
    ws.send({
      id: crypto.randomUUID(),
      type: (hwConnected ? 'streamdeck:disconnect' : 'streamdeck:reconnect') as any,
      payload: {},
      timestamp: Date.now(),
    });
  }, [hwConnected, ws.send]);

  const handleModeChange = useCallback((newMode: 'editing' | 'training') => {
    ws.send({
      id: crypto.randomUUID(),
      type: 'streamdeck:set-mode' as any,
      payload: { mode: newMode },
      timestamp: Date.now(),
    });
    setMode(newMode);
  }, [ws.send]);

  return (
    <div style={{ padding: 8, height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '4px 0',
        borderBottom: '1px solid #333',
        marginBottom: 8,
        gap: 6,
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Mayday Shortcuts</span>

        {/* Mode toggle */}
        <div style={{ display: 'flex', borderRadius: 4, overflow: 'hidden', border: '1px solid #444' }}>
          {(['editing', 'training'] as const).map(m => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              style={{
                background: mode === m ? '#2680eb' : '#2a2a2a',
                color: mode === m ? '#fff' : '#888',
                border: 'none',
                padding: '2px 8px',
                fontSize: 10,
                fontWeight: mode === m ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Hardware disconnect/reconnect button */}
          <button
            onClick={handleDisconnectToggle}
            style={{
              background: hwConnected ? '#7f1d1d' : '#14532d',
              color: hwConnected ? '#fca5a5' : '#86efac',
              border: 'none',
              borderRadius: 3,
              padding: '2px 6px',
              fontSize: 9,
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            {hwConnected ? 'Disconnect' : 'Reconnect'}
          </button>

          {/* Server connection status */}
          <span style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 3,
            background: ws.connected ? '#1b4332' : '#442222',
            color: ws.connected ? '#4ade80' : '#f87171',
          }}>
            {ws.connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>
      <StreamDeckGrid
        connected={ws.connected}
        send={ws.send}
        onMessage={ws.onMessage}
        mode={mode}
      />
    </div>
  );
}
