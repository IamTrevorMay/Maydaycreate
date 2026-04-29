import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getServerBridge, onServerStatus } from './server-bridge.js';
import { loadConfig, updateConfig } from './config-store.js';
import { migrateSyncSource } from '@mayday/sync-engine';
import type { BrowserWindow } from 'electron';
import type { YouTubeAnalyzer } from './youtube/youtube-analyzer.js';
import { registerYouTubeHandlers } from './youtube/ipc-youtube.js';
import { registerCuttingBoardHandlers } from './cutting-board-ipc.js';
import { checkForUpdates, downloadAndInstallUpdate, quitAndInstall, pushVersion, relaunchApp } from './auto-updater.js';
import {
  getAvailablePlugins,
  installPlugin,
  updatePlugin,
  uninstallPlugin,
  checkForPluginUpdates,
} from './plugin-manager.js';
import { getInstalledPlugin } from './config-store.js';

let _youtubeAnalyzer: YouTubeAnalyzer | null = null;

export function setYouTubeAnalyzer(analyzer: YouTubeAnalyzer): void {
  _youtubeAnalyzer = analyzer;
}

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  main: z.string().default('src/index.ts'),
  repository: z.string().optional(),
  minSdkVersion: z.string().optional(),
  hasCep: z.boolean().optional(),
  commands: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
  })).optional(),
  config: z.record(z.object({
    type: z.enum(['string', 'number', 'boolean', 'select']),
    label: z.string(),
    default: z.unknown(),
    options: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })).optional(),
    description: z.string().optional(),
  })).optional(),
  permissions: z.array(z.enum(['timeline', 'media', 'ai', 'effects', 'filesystem', 'network'])).optional(),
  ui: z.object({
    page: z.boolean().optional(),
    sidebarLabel: z.string().optional(),
    sidebarIcon: z.string().optional(),
    sidebarOrder: z.number().optional(),
    rendererEntry: z.string().optional(),
  }).optional(),
  marketplace: z.object({
    category: z.enum(['editing', 'analysis', 'effects', 'automation', 'hardware', 'utility']).optional(),
    tags: z.array(z.string()).optional(),
    icon: z.string().optional(),
    screenshots: z.array(z.string()).optional(),
    homepage: z.string().optional(),
    repository: z.string().optional(),
  }).optional(),
  dependencies: z.array(z.string()).optional(),
  targetApp: z.enum(['premiere', 'davinci', 'any']).optional(),
});

let _win: BrowserWindow | null = null;

export function setMainWindow(win: BrowserWindow): void {
  _win = win;
}

export function registerIpcHandlers(): void {
  registerCuttingBoardHandlers();

  // ── Plugins ────────────────────────────────────────────────────────────────

  ipcMain.handle('plugins:getAll', () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.getAllPlugins().map(p => ({
      ...p,
      isExternal: !!getInstalledPlugin(p.manifest.id),
    }));
  });

  ipcMain.handle('plugins:enable', async (_e, id: string) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    await bridge.lifecycle.activatePlugin(id);
  });

  ipcMain.handle('plugins:disable', async (_e, id: string) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    await bridge.lifecycle.deactivatePlugin(id);
  });

  ipcMain.handle('plugins:getConfig', (_e, id: string) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.getPluginConfig(id);
  });

  ipcMain.handle('plugins:setConfigValue', (_e, id: string, key: string, value: unknown) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    bridge.lifecycle.setPluginConfigValue(id, key, value);
  });

  ipcMain.handle('plugins:install', async (_e, sourcePath: string) => {
    const manifestPath = path.join(sourcePath, 'mayday.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('No mayday.json found at path');
    }

    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = ManifestSchema.parse(raw);

    const config = loadConfig();
    const isDev = !app.isPackaged;
    const cwd = process.cwd();
    const pluginsDir = isDev
      ? path.resolve(cwd, 'plugins')
      : path.join(process.resourcesPath, 'plugins');

    const destDir = path.join(pluginsDir, manifest.id);
    fs.cpSync(sourcePath, destDir, { recursive: true });

    const bridge = getServerBridge();
    if (bridge) {
      const mainPath = path.join(destDir, manifest.main);
      await bridge.lifecycle.loadPlugin(manifest, mainPath);
      await bridge.lifecycle.activatePlugin(manifest.id);
    }

    return manifest;
  });

  // ── Plugin Manager ───────────────────────────────────────────────────────

  ipcMain.handle('plugins:getAvailable', () => {
    return getAvailablePlugins();
  });

  ipcMain.handle('plugins:installFromRepo', async (_e, pluginId: string) => {
    await installPlugin(pluginId, (progress) => {
      if (_win && !_win.isDestroyed()) {
        _win.webContents.send('plugins:installProgress', progress);
      }
    });
  });

  ipcMain.handle('plugins:update', async (_e, pluginId: string) => {
    await updatePlugin(pluginId, (progress) => {
      if (_win && !_win.isDestroyed()) {
        _win.webContents.send('plugins:installProgress', progress);
      }
    });
  });

  ipcMain.handle('plugins:uninstall', async (_e, pluginId: string) => {
    await uninstallPlugin(pluginId);
  });

  ipcMain.handle('plugins:checkUpdates', async () => {
    return checkForPluginUpdates();
  });

  // ── Server ─────────────────────────────────────────────────────────────────

  ipcMain.handle('server:getStatus', () => {
    const bridge = getServerBridge();
    if (!bridge) return { running: false, port: 0, uptime: 0, activePlugins: 0 };
    return bridge.getStatus();
  });

  // ── Sync (proxied to premiere-pro-sync plugin) ─────────────────────────────

  ipcMain.handle('sync:getStatus', async () => {
    const bridge = getServerBridge();
    if (!bridge) return { state: 'idle', pendingCount: 0, conflictCount: 0 };
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'get-status');
  });

  ipcMain.handle('sync:runSync', async () => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'run-sync');
  });

  ipcMain.handle('sync:getConflicts', async () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'get-conflicts');
  });

  ipcMain.handle('sync:resolveConflict', async (_e, resolution: unknown) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'resolve-conflict', resolution);
  });

  ipcMain.handle('sync:getSyncLog', async () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'get-sync-log');
  });

  ipcMain.handle('sync:getQueue', async () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'get-queue');
  });

  ipcMain.handle('sync:flushQueue', async () => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'flush-queue');
  });

  // ── History (proxied to premiere-pro-sync plugin) ──────────────────────────

  ipcMain.handle('history:list', async () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'list-snapshots');
  });

  ipcMain.handle('history:createSnapshot', async () => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'create-snapshot');
  });

  ipcMain.handle('history:restore', async (_e, snapshot: unknown) => {
    const bridge = getServerBridge();
    if (!bridge) throw new Error('Server not running');
    return bridge.lifecycle.executeCommand('premiere-pro-sync', 'restore-snapshot', snapshot);
  });

  // ── Config ─────────────────────────────────────────────────────────────────

  ipcMain.handle('config:get', () => {
    return loadConfig();
  });

  ipcMain.handle('config:setSyncSourcePath', (_e, newPath: string) => {
    return updateConfig({ syncSourcePath: newPath });
  });

  ipcMain.handle('config:setAutoLaunch', (_e, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled });
    return updateConfig({ autoLaunchOnLogin: enabled });
  });

  ipcMain.handle('config:setAnthropicApiKey', (_e, key: string) => {
    process.env.ANTHROPIC_API_KEY = key;
    return updateConfig({ anthropicApiKey: key });
  });

  ipcMain.handle('config:setSupabaseUrl', (_e, url: string) => {
    return updateConfig({ supabaseUrl: url });
  });

  ipcMain.handle('config:setSupabaseAnonKey', (_e, key: string) => {
    return updateConfig({ supabaseAnonKey: key });
  });

  ipcMain.handle('config:setAutoUpdate', (_e, enabled: boolean) => {
    return updateConfig({ autoUpdate: enabled });
  });

  ipcMain.handle('config:setGhToken', (_e, token: string) => {
    return updateConfig({ ghToken: token });
  });

  ipcMain.handle('config:migrateSyncSource', async (_e, oldPath: string, newPath: string) => {
    await migrateSyncSource(oldPath, newPath, (progress) => {
      _win?.webContents.send('config:migrationProgress', progress);
    });
    return updateConfig({ syncSourcePath: newPath });
  });

  // ── App ───────────────────────────────────────────────────────────────────

  ipcMain.handle('app:getVersion', () => {
    return { version: app.getVersion(), name: app.getName() };
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    return checkForUpdates();
  });

  ipcMain.handle('app:installUpdate', async () => {
    await downloadAndInstallUpdate();
  });

  ipcMain.handle('app:downloadUpdate', async () => {
    await downloadAndInstallUpdate();
  });

  ipcMain.handle('app:quitAndInstall', () => {
    quitAndInstall();
  });

  ipcMain.handle('app:pushVersion', async () => {
    if (!_win) throw new Error('No window available');
    const config = loadConfig();
    return pushVersion(config.sourceRepoPath, config.ghToken, _win);
  });

  ipcMain.handle('app:relaunch', () => {
    relaunchApp();
  });

  // ── Dialog ─────────────────────────────────────────────────────────────────

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:openPlugin', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      message: 'Select a plugin folder (must contain mayday.json)',
    });
    return result.canceled ? null : result.filePaths[0];
  });

}

/** Register YouTube IPC handlers — call after window is created */
export function registerYouTubeIpc(): void {
  if (_youtubeAnalyzer && _win) {
    registerYouTubeHandlers(_youtubeAnalyzer, _win);
  }
}

/** Push sync status changes to renderer via IPC events */
export function bridgeSyncEvents(): void {
  const bridge = getServerBridge();
  if (bridge?.eventBus) {
    bridge.eventBus.on('plugin:premiere-pro-sync:sync-status', (event: { data: unknown }) => {
      if (_win && !_win.isDestroyed()) _win.webContents.send('sync:statusChanged', event.data);
    });
  }
}

/** Push server status changes to renderer */
export function bridgeServerEvents(): void {
  onServerStatus((status) => {
    if (_win && !_win.isDestroyed()) _win.webContents.send('server:statusChanged', status);
  });
}

/** Push plugin list to renderer whenever plugins change (activate/deactivate/reload) */
export function bridgePluginEvents(): void {
  const bridge = getServerBridge();
  if (!bridge || !_win) return;

  const push = () => {
    if (_win && !_win.isDestroyed()) {
      _win.webContents.send('plugins:changed', bridge.lifecycle.getAllPlugins());
    }
  };

  // Send current state immediately (covers the server-ready race)
  push();

  // Forward lifecycle events
  for (const event of ['plugin:activated', 'plugin:deactivated', 'plugin:reloaded']) {
    bridge.eventBus.on(event, () => push());
  }
}
