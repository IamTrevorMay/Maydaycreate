import { useState, useEffect, useCallback, useRef } from 'react';
import type { BridgeMessage } from '@mayday/types';

const WS_URL = 'ws://localhost:9876';
const RECONNECT_INTERVAL = 3000;

type MessageCallback = (payload: unknown) => void;

interface StreamDeckWebSocketState {
  connected: boolean;
  send: (message: BridgeMessage) => void;
  onMessage: (type: string, callback: MessageCallback) => () => void;
}

export function useStreamDeckWebSocket(): StreamDeckWebSocketState {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();
  const listenersRef = useRef(new Map<string, Set<MessageCallback>>());

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'panel:ready',
          payload: { panelId: 'streamdeck' },
          timestamp: Date.now(),
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: BridgeMessage = JSON.parse(event.data);
          const cbs = listenersRef.current.get(message.type);
          if (cbs) {
            for (const cb of cbs) {
              try { cb(message.payload); } catch (err) {
                console.error(`[StreamDeck] Listener error for ${message.type}:`, err);
              }
            }
          }
        } catch (err) {
          console.error('[StreamDeck] Message parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, RECONNECT_INTERVAL);
      };

      ws.onerror = () => { ws.close(); };
    } catch {
      reconnectRef.current = setTimeout(connect, RECONNECT_INTERVAL);
    }
  }, []);

  const send = useCallback((message: BridgeMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const onMessage = useCallback((type: string, callback: MessageCallback): (() => void) => {
    const listeners = listenersRef.current;
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type)!.add(callback);
    return () => { listeners.get(type)?.delete(callback); };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, send, onMessage };
}
