import type { PluginManifest, PluginStatus } from './plugin.js';

export interface LauncherPluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  installedAt?: number;
  syncedFromRemote?: boolean;
}

export interface ServerStatus {
  running: boolean;
  port: number;
  uptime: number;
  activePlugins: number;
}
