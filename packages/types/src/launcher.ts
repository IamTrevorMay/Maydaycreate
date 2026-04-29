import type { PluginManifest, PluginStatus } from './plugin.js';

export interface LauncherPluginInfo {
  manifest: PluginManifest;
  status: PluginStatus;
  installedAt?: number;
  syncedFromRemote?: boolean;
  /** True if installed via Plugin Manager (can be uninstalled). False for monorepo plugins. */
  isExternal?: boolean;
}

export interface ServerStatus {
  running: boolean;
  port: number;
  uptime: number;
  activePlugins: number;
}

/** Tracks a plugin installed from a remote GitHub repo */
export interface InstalledPluginRecord {
  id: string;
  version: string;
  repository: string;
  installedAt: number;
  cepInstalled: boolean;
}

/** Entry in plugin-compatibility.json */
export interface CompatibilityEntry {
  repository: string;
  compatible: string;
  recommended: string;
  description: string;
}

/** Root shape of plugin-compatibility.json */
export interface PluginCompatibilityManifest {
  sdkVersion: string;
  plugins: Record<string, CompatibilityEntry>;
}

/** Info about a plugin available for install (merged from compatibility + GitHub) */
export interface AvailablePluginInfo {
  id: string;
  repository: string;
  compatible: string;
  recommended: string;
  description: string;
  installed: boolean;
  installedVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
}

/** Progress info for plugin install/update operations */
export interface PluginInstallProgress {
  phase: 'downloading' | 'extracting' | 'installing' | 'activating' | 'done' | 'error';
  message: string;
  pluginId?: string;
  error?: string;
}
