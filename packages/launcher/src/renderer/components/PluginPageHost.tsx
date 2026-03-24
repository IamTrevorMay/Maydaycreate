import React, { useRef, useEffect, useCallback } from 'react';
import { useIpc } from '../hooks/useIpc.js';
import { c } from '../styles.js';

interface Props {
  pluginId: string;
  rendererEntry: string; // e.g. "ui/index.html"
}

/**
 * Hosts a plugin's UI page inside a sandboxed iframe.
 * Communication happens via postMessage with a simple typed protocol.
 *
 * Protocol (plugin → host):
 *   { type: 'plugin:ready' }
 *   { type: 'plugin:command', command: string, args?: Record<string, unknown>, reqId?: string }
 *   { type: 'plugin:toast', message: string, level?: 'info'|'success'|'warning'|'error' }
 *
 * Protocol (host → plugin):
 *   { type: 'host:theme', tokens: Record<string, string> }
 *   { type: 'host:config', config: Record<string, unknown> }
 *   { type: 'host:command-result', reqId: string, result?: unknown, error?: string }
 */
export function PluginPageHost({ pluginId, rendererEntry }: Props): React.ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ipc = useIpc();

  const sendToPlugin = useCallback((type: string, data: Record<string, unknown> = {}) => {
    iframeRef.current?.contentWindow?.postMessage({ type, ...data }, '*');
  }, []);

  // Listen for messages from the plugin iframe
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      // Only accept messages from our iframe
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'plugin:ready':
          // Send theme tokens and config to the plugin
          sendToPlugin('host:theme', { tokens: c });
          break;

        case 'plugin:command': {
          const { command, args, reqId } = msg;
          try {
            // Execute the command via the server plugin system
            const bridge = await ipc.server.getStatus();
            if (!bridge.running) throw new Error('Server not running');

            const result = await fetch(
              `http://localhost:${bridge.port}/api/plugins/${pluginId}/command/${command}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args ?? {}),
              },
            ).then((r) => r.json());

            if (reqId) sendToPlugin('host:command-result', { reqId, result });
          } catch (err) {
            if (reqId) sendToPlugin('host:command-result', {
              reqId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          break;
        }

        case 'plugin:toast': {
          // Could use Electron notification or custom toast — for now, log
          console.log(`[Plugin:${pluginId}] Toast: ${msg.message}`);
          break;
        }
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [pluginId, ipc, sendToPlugin]);

  const src = `mayday-plugin://${pluginId}/${rendererEntry}`;

  return (
    <iframe
      ref={iframeRef}
      src={src}
      sandbox="allow-scripts allow-same-origin"
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        background: c.bg.primary,
      }}
    />
  );
}
