/**
 * Client-side SDK for plugin UI pages hosted in the launcher.
 *
 * Usage in a plugin's ui/main.ts:
 * ```ts
 * import { MaydayPluginUI } from '@mayday/sdk/ui';
 *
 * const ui = new MaydayPluginUI();
 *
 * // Wait for theme tokens from the host
 * ui.onTheme((tokens) => {
 *   document.body.style.background = tokens.bg.primary;
 * });
 *
 * // Execute a plugin command
 * const result = await ui.executeCommand('analyze', { threshold: -30 });
 *
 * // Show a toast notification
 * ui.showToast('Analysis complete!', 'success');
 * ```
 */

type MessageHandler = (type: string, data: Record<string, unknown>) => void;
type ThemeTokens = Record<string, unknown>;

export class MaydayPluginUI {
  private handlers: MessageHandler[] = [];
  private themeHandlers: Array<(tokens: ThemeTokens) => void> = [];
  private configHandlers: Array<(config: Record<string, unknown>) => void> = [];
  private pendingCommands = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  }>();
  private reqCounter = 0;

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (!msg || typeof msg.type !== 'string') return;

      // Dispatch to specific handlers
      switch (msg.type) {
        case 'host:theme':
          for (const h of this.themeHandlers) h(msg.tokens);
          break;
        case 'host:config':
          for (const h of this.configHandlers) h(msg.config);
          break;
        case 'host:command-result': {
          const pending = this.pendingCommands.get(msg.reqId);
          if (pending) {
            this.pendingCommands.delete(msg.reqId);
            if (msg.error) pending.reject(new Error(msg.error));
            else pending.resolve(msg.result);
          }
          break;
        }
      }

      // Generic handlers
      for (const h of this.handlers) h(msg.type, msg);
    });

    // Announce readiness to the host
    this.send('plugin:ready');
  }

  /** Execute a plugin command on the server via the host bridge */
  executeCommand(command: string, args?: Record<string, unknown>): Promise<unknown> {
    const reqId = `req_${++this.reqCounter}`;
    return new Promise((resolve, reject) => {
      this.pendingCommands.set(reqId, { resolve, reject });
      this.send('plugin:command', { command, args, reqId });
    });
  }

  /** Show a toast notification via the host */
  showToast(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void {
    this.send('plugin:toast', { message, level });
  }

  /** Subscribe to theme token updates from the host */
  onTheme(handler: (tokens: ThemeTokens) => void): () => void {
    this.themeHandlers.push(handler);
    return () => {
      this.themeHandlers = this.themeHandlers.filter((h) => h !== handler);
    };
  }

  /** Subscribe to config updates from the host */
  onConfig(handler: (config: Record<string, unknown>) => void): () => void {
    this.configHandlers.push(handler);
    return () => {
      this.configHandlers = this.configHandlers.filter((h) => h !== handler);
    };
  }

  /** Subscribe to all messages from the host */
  onMessage(handler: MessageHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  private send(type: string, data: Record<string, unknown> = {}): void {
    window.parent.postMessage({ type, ...data }, '*');
  }
}
