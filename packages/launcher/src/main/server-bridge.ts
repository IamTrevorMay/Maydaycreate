import { app } from 'electron';
import path from 'path';
import { createRequire } from 'module';
import type { ServerStatus } from '@mayday/types';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let serverInstance: any = null;
let serverStartTime = 0;

export interface ServerBridge {
  getStatus(): ServerStatus;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lifecycle: any;
}

let _bridge: ServerBridge | null = null;
let _statusListeners: Array<(status: ServerStatus) => void> = [];

function makeStatus(): ServerStatus {
  if (!serverInstance) {
    return { running: false, port: 0, uptime: 0, activePlugins: 0 };
  }

  let activePlugins = 0;
  try {
    activePlugins = serverInstance.lifecycle?.getActivePlugins?.()?.length ?? 0;
  } catch {
    // lifecycle may not be ready yet
  }

  return {
    running: true,
    port: serverInstance._port ?? 0,
    uptime: Date.now() - serverStartTime,
    activePlugins,
  };
}

export function onServerStatus(cb: (status: ServerStatus) => void): { unsubscribe(): void } {
  _statusListeners.push(cb);
  return {
    unsubscribe: () => {
      _statusListeners = _statusListeners.filter(l => l !== cb);
    },
  };
}

function emitStatus(): void {
  const s = makeStatus();
  for (const l of _statusListeners) l(s);
}

export async function startEmbeddedServer(opts: {
  port: number;
  isDev: boolean;
  resourcesPath: string;
}): Promise<ServerBridge> {
  if (_bridge) return _bridge;

  // Dynamic import that rollup can't statically analyze — prevents bundling
  const serverModule = '@mayday/server';
  const mod = await (Function('m', 'return import(m)')(serverModule) as Promise<any>);
  const startServer = mod.startServer ?? mod.default?.startServer;

  if (typeof startServer !== 'function') {
    console.error('[ServerBridge] startServer not found in module. Keys:', Object.keys(mod));
    throw new Error('startServer is not a function');
  }

  // In dev mode, use the monorepo's plugins/ directory
  const pluginsDir = opts.isDev
    ? path.resolve(app.getAppPath(), '../../plugins')
    : path.join(opts.resourcesPath, 'plugins');

  const dataDir = path.join(app.getPath('userData'), 'plugin-data');

  serverStartTime = Date.now();

  serverInstance = await startServer({
    port: opts.port,
    pluginsDir,
    dataDir,
  });

  // Patch port onto serverInstance so makeStatus() can read it
  serverInstance._port = opts.port;

  _bridge = {
    getStatus: makeStatus,
    lifecycle: serverInstance.lifecycle,
  };

  emitStatus();

  // Periodically emit status so renderer stays in sync
  setInterval(emitStatus, 5000);

  return _bridge;
}

export function getServerBridge(): ServerBridge | null {
  return _bridge;
}
