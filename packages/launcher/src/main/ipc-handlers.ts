import { ipcMain, dialog, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import { getServerBridge, onServerStatus } from './server-bridge.js';
import { loadConfig, updateConfig } from './config-store.js';
import type { ConflictResolution } from '@mayday/sync-engine';
import { migrateSyncSource } from '@mayday/sync-engine';
import type { BrowserWindow } from 'electron';
import type { YouTubeAnalyzer } from './youtube/youtube-analyzer.js';
import { registerYouTubeHandlers } from './youtube/ipc-youtube.js';
import { checkForUpdates, installUpdate, pushVersion, relaunchApp } from './auto-updater.js';

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
});

let _syncEngine: import('@mayday/sync-engine').SyncEngine | null = null;
let _win: BrowserWindow | null = null;

export function setSyncEngine(engine: import('@mayday/sync-engine').SyncEngine): void {
  _syncEngine = engine;
}

export function setMainWindow(win: BrowserWindow): void {
  _win = win;
}

export function registerIpcHandlers(): void {
  // ── Plugins ────────────────────────────────────────────────────────────────

  ipcMain.handle('plugins:getAll', () => {
    const bridge = getServerBridge();
    if (!bridge) return [];
    return bridge.lifecycle.getAllPlugins();
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

  // ── Server ─────────────────────────────────────────────────────────────────

  ipcMain.handle('server:getStatus', () => {
    const bridge = getServerBridge();
    if (!bridge) return { running: false, port: 0, uptime: 0, activePlugins: 0 };
    return bridge.getStatus();
  });

  // ── Sync ───────────────────────────────────────────────────────────────────

  ipcMain.handle('sync:getStatus', () => {
    return _syncEngine?.getStatus() ?? { state: 'idle', pendingCount: 0, conflictCount: 0 };
  });

  ipcMain.handle('sync:runSync', async () => {
    if (!_syncEngine) throw new Error('Sync engine not initialized');
    await _syncEngine.runSync();
  });

  ipcMain.handle('sync:getConflicts', () => {
    return _syncEngine?.getConflicts() ?? [];
  });

  ipcMain.handle('sync:resolveConflict', async (_e, resolution: ConflictResolution) => {
    if (!_syncEngine) throw new Error('Sync engine not initialized');
    await _syncEngine.resolveConflict(resolution);
  });

  ipcMain.handle('sync:getSyncLog', () => {
    return _syncEngine?.getSyncLog() ?? [];
  });

  ipcMain.handle('sync:getQueue', () => {
    return _syncEngine?.getQueue() ?? [];
  });

  ipcMain.handle('sync:flushQueue', async () => {
    if (!_syncEngine) throw new Error('Sync engine not initialized');
    await _syncEngine.flushQueue();
  });

  // ── History ────────────────────────────────────────────────────────────────

  ipcMain.handle('history:list', () => {
    return _syncEngine?.listSnapshots() ?? [];
  });

  ipcMain.handle('history:createSnapshot', () => {
    if (!_syncEngine) throw new Error('Sync engine not initialized');
    return _syncEngine.createSnapshot();
  });

  ipcMain.handle('history:restore', (_e, snapshot: import('@mayday/sync-engine').HistorySnapshot) => {
    if (!_syncEngine) throw new Error('Sync engine not initialized');
    _syncEngine.restoreSnapshot(snapshot);
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
    const config = loadConfig();
    return checkForUpdates(config.sourceRepoPath);
  });

  ipcMain.handle('app:installUpdate', async () => {
    if (!_win) throw new Error('No window available');
    const config = loadConfig();
    await installUpdate(config.sourceRepoPath, _win);
  });

  ipcMain.handle('app:pushVersion', async () => {
    if (!_win) throw new Error('No window available');
    const config = loadConfig();
    return pushVersion(config.sourceRepoPath, _win);
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
  if (!_syncEngine) return;
  _syncEngine.onStatusChanged((status) => {
    if (_win && !_win.isDestroyed()) _win.webContents.send('sync:statusChanged', status);
  });
}

/** Push server status changes to renderer */
export function bridgeServerEvents(): void {
  onServerStatus((status) => {
    if (_win && !_win.isDestroyed()) _win.webContents.send('server:statusChanged', status);
  });
}
