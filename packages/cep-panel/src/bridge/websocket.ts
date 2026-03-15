import { useState, useEffect, useCallback, useRef } from 'react';
import type { BridgeMessage, ServerStatusPayload, ExtendScriptCallPayload } from '@mayday/types';
import { evalExtendScript } from './cs-interface.js';

const WS_URL = 'ws://localhost:9876';
const RECONNECT_INTERVAL = 3000;

type MessageCallback = (payload: unknown) => void;

interface WebSocketState {
  connected: boolean;
  serverStatus: ServerStatusPayload | null;
  send: (message: BridgeMessage) => void;
  onMessage: (type: string, callback: MessageCallback) => () => void;
}

const listeners = new Map<string, Set<MessageCallback>>();

export function useWebSocket(): WebSocketState {
  const [connected, setConnected] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatusPayload | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[Mayday] Connected to server');
        // Notify server that panel is ready
        ws.send(JSON.stringify({
          id: crypto.randomUUID(),
          type: 'panel:ready',
          payload: {},
          timestamp: Date.now(),
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const message: BridgeMessage = JSON.parse(event.data);
          await handleMessage(message, ws);
        } catch (err) {
          console.error('[Mayday] Message parse error:', err);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectRef.current = setTimeout(connect, RECONNECT_INTERVAL);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectRef.current = setTimeout(connect, RECONNECT_INTERVAL);
    }
  }, []);

  const handleMessage = async (message: BridgeMessage, ws: WebSocket) => {
    switch (message.type) {
      case 'server:status':
        setServerStatus(message.payload as ServerStatusPayload);
        break;

      case 'extendscript:call': {
        const payload = message.payload as ExtendScriptCallPayload;
        try {
          const result = await evalExtendScript(payload.fn, payload.args);
          ws.send(JSON.stringify({
            id: crypto.randomUUID(),
            type: 'extendscript:result',
            payload: { requestId: message.id, result },
            timestamp: Date.now(),
          }));
        } catch (err) {
          ws.send(JSON.stringify({
            id: crypto.randomUUID(),
            type: 'extendscript:error',
            payload: { requestId: message.id, error: String(err) },
            timestamp: Date.now(),
          }));
        }
        break;
      }

      default: {
        // Dispatch to registered listeners for plugin:* and ui:* messages
        const cbs = listeners.get(message.type);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(message.payload);
            } catch (err) {
              console.error(`[Mayday] Listener error for ${message.type}:`, err);
            }
          }
        }
        break;
      }
    }
  };

  const send = useCallback((message: BridgeMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  const onMessage = useCallback((type: string, callback: MessageCallback): (() => void) => {
    if (!listeners.has(type)) {
      listeners.set(type, new Set());
    }
    listeners.get(type)!.add(callback);
    return () => {
      listeners.get(type)?.delete(callback);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { connected, serverStatus, send, onMessage };
}
