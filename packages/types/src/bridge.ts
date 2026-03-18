/** Message types for the WebSocket bridge protocol */

export type BridgeMessageType =
  | 'extendscript:call'
  | 'extendscript:result'
  | 'extendscript:error'
  | 'plugin:command'
  | 'plugin:result'
  | 'plugin:error'
  | 'event:emit'
  | 'event:subscribe'
  | 'server:status'
  | 'panel:ready'
  | 'ui:toast'
  | 'ui:progress'
  | `plugin:${string}`;

export interface BridgeMessage<T = unknown> {
  id: string;
  type: BridgeMessageType;
  payload: T;
  timestamp: number;
}

export interface ExtendScriptCallPayload {
  script: string;
  fn: string;
  args: unknown[];
  priority?: boolean;
}

export interface ExtendScriptResultPayload {
  requestId: string;
  result: unknown;
}

export interface ExtendScriptErrorPayload {
  requestId: string;
  error: string;
}

export interface PluginCommandPayload {
  pluginId: string;
  command: string;
  args?: Record<string, unknown>;
}

export interface PluginResultPayload {
  requestId: string;
  pluginId: string;
  result: unknown;
}

export interface PluginErrorPayload {
  requestId: string;
  pluginId: string;
  error: string;
}

export interface ServerStatusPayload {
  status: 'ready' | 'starting' | 'stopping' | 'error';
  plugins: number;
  uptime: number;
}
