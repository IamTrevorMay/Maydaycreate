import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { InstalledPluginRecord } from '@mayday/types';

export interface LauncherConfig {
  syncSourcePath: string;
  machineId: string;
  machineName: string;
  serverPort: number;
  autoLaunchOnLogin: boolean;
  startMinimized: boolean;
  anthropicApiKey: string;
  sourceRepoPath: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  autoUpdate: boolean;
  ghToken: string;
  installedPlugins: InstalledPluginRecord[];
}

const DEFAULTS: LauncherConfig = {
  syncSourcePath: '',
  machineId: uuid(),
  machineName: require('os').hostname(),
  serverPort: 9876,
  autoLaunchOnLogin: true,
  startMinimized: true,
  anthropicApiKey: '',
  sourceRepoPath: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  autoUpdate: true,
  ghToken: '',
  installedPlugins: [],
};

function getConfigPath(): string {
  const primary = path.join(app.getPath('userData'), 'launcher-config.json');
  if (fs.existsSync(primary)) return primary;

  // In dev mode, userData is "Electron" — fall back to the packaged app's config
  const packaged = path.join(app.getPath('home'), 'Library', 'Application Support', '@mayday', 'launcher', 'launcher-config.json');
  if (fs.existsSync(packaged)) {
    console.log('[Config] Using packaged app config:', packaged);
    return packaged;
  }

  return primary;
}

let _config: LauncherConfig | null = null;

export function loadConfig(): LauncherConfig {
  if (_config) return _config;

  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      _config = { ...DEFAULTS, ...raw };
    } catch {
      _config = { ...DEFAULTS };
    }
  } else {
    _config = { ...DEFAULTS };
    saveConfig(_config);
  }

  return _config;
}

export function saveConfig(config: LauncherConfig): void {
  _config = config;
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(partial: Partial<LauncherConfig>): LauncherConfig {
  const current = loadConfig();
  const updated = { ...current, ...partial };
  saveConfig(updated);
  return updated;
}

// ── Installed plugin helpers ──────────────────────────────────────────────────

export function getInstalledPlugins(): InstalledPluginRecord[] {
  return loadConfig().installedPlugins ?? [];
}

export function getInstalledPlugin(id: string): InstalledPluginRecord | undefined {
  return getInstalledPlugins().find(p => p.id === id);
}

export function addInstalledPlugin(record: InstalledPluginRecord): void {
  const plugins = getInstalledPlugins().filter(p => p.id !== record.id);
  plugins.push(record);
  updateConfig({ installedPlugins: plugins });
}

export function removeInstalledPlugin(id: string): void {
  const plugins = getInstalledPlugins().filter(p => p.id !== id);
  updateConfig({ installedPlugins: plugins });
}

export function updateInstalledPlugin(id: string, partial: Partial<InstalledPluginRecord>): void {
  const plugins = getInstalledPlugins().map(p =>
    p.id === id ? { ...p, ...partial } : p,
  );
  updateConfig({ installedPlugins: plugins });
}

/** Directory where remotely-installed plugins are stored */
export function getExternalPluginsDir(): string {
  return path.join(app.getPath('userData'), 'plugins');
}

/** CEP extensions directory on macOS */
export function getCepExtensionsDir(): string {
  return path.join(
    app.getPath('home'),
    'Library', 'Application Support', 'Adobe', 'CEP', 'extensions',
  );
}
