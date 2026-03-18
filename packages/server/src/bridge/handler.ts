import { WebSocket } from 'ws';
import { v4 as uuid } from 'uuid';
import type { BridgeMessage, BridgeMessageType, ExtendScriptCallPayload, ExtendScriptResultPayload } from '@mayday/types';
import { createExtendScriptCall } from './protocol.js';

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class BridgeHandler {
  private cep: WebSocket | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private callTimeout = 30000;

  setCepConnection(ws: WebSocket) {
    this.cep = ws;
  }

  clearCepConnection() {
    this.cep = null;
    // Reject all pending calls
    for (const [id, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('CEP connection lost'));
      this.pendingCalls.delete(id);
    }
  }

  isConnected(): boolean {
    return this.cep !== null && this.cep.readyState === WebSocket.OPEN;
  }

  handleMessage(message: BridgeMessage, _ws: WebSocket) {
    switch (message.type) {
      case 'extendscript:result': {
        const payload = message.payload as ExtendScriptResultPayload;
        const pending = this.pendingCalls.get(payload.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCalls.delete(payload.requestId);
          pending.resolve(payload.result);
        }
        break;
      }
      case 'extendscript:error': {
        const payload = message.payload as { requestId: string; error: string };
        console.error(`[Bridge] ExtendScript error for ${payload.requestId}:`, payload.error);
        const pending = this.pendingCalls.get(payload.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCalls.delete(payload.requestId);
          pending.reject(new Error(payload.error));
        }
        break;
      }
      case 'panel:ready':
        console.log('[Mayday] CEP panel ready');
        break;
      default:
        console.log('[Mayday] Unhandled message type:', message.type);
    }
  }

  sendToPanel(message: BridgeMessage): void {
    if (!this.isConnected()) {
      console.warn('[Bridge] Cannot send to panel — CEP not connected');
      return;
    }
    this.cep!.send(JSON.stringify(message));
  }

  async callExtendScript(fn: string, args: unknown[] = [], options?: { priority?: boolean }): Promise<unknown> {
    if (!this.isConnected()) {
      throw new Error('CEP panel not connected. Open Premiere Pro and the Mayday extension.');
    }

    const message = createExtendScriptCall(fn, args, options?.priority);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(message.id);
        reject(new Error(`ExtendScript call timed out: ${fn}`));
      }, this.callTimeout);

      this.pendingCalls.set(message.id, { resolve, reject, timeout });
      this.cep!.send(JSON.stringify(message));
    });
  }
}
