import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

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
}

const DEFAULTS: LauncherConfig = {
  syncSourcePath: '',
  machineId: uuid(),
  machineName: require('os').hostname(),
  serverPort: 9876,
  autoLaunchOnLogin: true,
  startMinimized: true,
  anthropicApiKey: '',
  sourceRepoPath: '/Users/trevormay/Desktop/MaydayCreate',
  supabaseUrl: '',
  supabaseAnonKey: '',
  autoUpdate: true,
  ghToken: '',
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'launcher-config.json');
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
