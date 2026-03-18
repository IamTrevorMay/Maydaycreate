import { app, BrowserWindow, shell, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { is } from '@electron-toolkit/utils';
import { loadConfig } from './config-store.js';
import { startEmbeddedServer, getServerBridge, stopEmbeddedServer } from './server-bridge.js';
import {
  registerIpcHandlers,
  setSyncEngine,
  setMainWindow,
  setYouTubeAnalyzer,
  registerYouTubeIpc,
  bridgeSyncEvents,
  bridgeServerEvents,
} from './ipc-handlers.js';
import { createTray } from './tray.js';
import { SyncEngine } from '@mayday/sync-engine';
import type { SyncSource } from '@mayday/sync-engine';
import { YouTubeAnalyzer } from './youtube/youtube-analyzer.js';
import { YouTubeSyncService } from './youtube/youtube-sync.js';
import { PresetSyncService } from './preset-sync.js';
import { StreamDeckSyncService } from './streamdeck-sync.js';
import { initAutoUpdater, silentAutoUpdate } from './auto-updater.js';
// Old Elgato SDK plugin installer — replaced by direct USB hardware control
// import { installStreamDeckPlugin } from './stream-deck-installer.js';

// Augment PATH for Dock-launched apps (they don't inherit shell PATH)
if (app.isPackaged) {
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
  const current = process.env.PATH || '';
  const missing = extraPaths.filter((p) => !current.includes(p));
  if (missing.length) {
    process.env.PATH = [...missing, current].join(':');
  }

  // Add app's node_modules to NODE_PATH so plugin ESM imports resolve.
  // With asar packing, we can't symlink into the archive — use NODE_PATH instead.
  const appNodeModules = path.join(app.getAppPath(), 'node_modules');
  const nodePath = process.env.NODE_PATH || '';
  if (!nodePath.includes(appNodeModules)) {
    process.env.NODE_PATH = nodePath ? `${nodePath}:${appNodeModules}` : appNodeModules;
    // @ts-ignore — Module._initPaths re-reads NODE_PATH at runtime
    require('module')._initPaths();
  }
}

// Migrate config from dev userData to packaged userData on first launch
if (app.isPackaged) {
  const packagedConfigPath = path.join(app.getPath('userData'), 'launcher-config.json');
  if (!fs.existsSync(packagedConfigPath)) {
    const devConfigPath = path.join(
      app.getPath('home'),
      'Library',
      'Application Support',
      '@mayday',
      'launcher',
      'launcher-config.json',
    );
    if (fs.existsSync(devConfigPath)) {
      fs.mkdirSync(path.dirname(packagedConfigPath), { recursive: true });
      fs.copyFileSync(devConfigPath, packagedConfigPath);
      console.log('[Launcher] Migrated config from dev userData');
    }
  }
}

// Enforce single instance — if another instance is already running, quit this one
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 800,
    minHeight: 560,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
    },
  });

  win.on('ready-to-show', () => {
    const config = loadConfig();
    if (!config.startMinimized) {
      win.show();
    }
  });


  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return win;
}

// When a second instance tries to launch, focus the existing window
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  // Register custom protocol for loading local frame images in renderer
  protocol.registerFileProtocol('mayday-frame', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('mayday-frame://', ''));
    callback({ path: filePath });
  });

  const config = loadConfig();

  // Ensure login item matches config
  app.setLoginItemSettings({ openAtLogin: config.autoLaunchOnLogin });

  // Set API key from config (falls back to env var if not configured)
  if (config.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }

  // Sync engine
  const syncEngine = new SyncEngine({
    syncSourcePath: config.syncSourcePath,
    machineId: config.machineId,
    machineName: config.machineName,
  });

  // Configure sync sources for Premiere Pro configs
  const syncSources = discoverSyncSources(app.getPath('home'));
  for (const source of syncSources) {
    syncEngine.addSyncSource(source);
  }
  console.log(`[Launcher] Configured ${syncSources.length} sync source(s):`, syncSources.map(s => s.name).join(', '));

  // YouTube analyzer
  const youtubeAnalyzer = new YouTubeAnalyzer();

  setSyncEngine(syncEngine);
  setYouTubeAnalyzer(youtubeAnalyzer);
  registerIpcHandlers();

  // Create window
  mainWindow = createWindow();
  setMainWindow(mainWindow);
  registerYouTubeIpc();
  bridgeSyncEvents();
  bridgeServerEvents();

  // Tray
  createTray(mainWindow);

  // Start embedded server
  await startEmbeddedServer({
    port: config.serverPort,
    isDev: is.dev,
    resourcesPath: process.resourcesPath,
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    machineId: config.machineId,
    machineName: config.machineName,
  });

  // YouTube → Supabase sync
  const ytSync = new YouTubeSyncService();
  ytSync.initialize({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    machineId: config.machineId,
    machineName: config.machineName,
  });
  ytSync.startPeriodicSync(youtubeAnalyzer.database);

  // Preset Vault → Supabase bidirectional sync
  const presetSync = new PresetSyncService();
  presetSync.initialize({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    machineId: config.machineId,
    machineName: config.machineName,
    presetDataDir: path.join(app.getPath('userData'), 'plugin-data', 'preset-vault'),
  });

  const bridge = getServerBridge();
  if (presetSync.isEnabled() && bridge?.eventBus) {
    bridge.eventBus.on('plugin:preset-vault:preset-saved', (event: { data?: { id?: string } }) => {
      presetSync.queuePush(event.data?.id);
      presetSync.pushChanges().catch(() => {});
    });
    bridge.eventBus.on('plugin:preset-vault:preset-deleted', (event: { data?: { presetId?: string } }) => {
      presetSync.queueDelete(event.data?.presetId);
      presetSync.pushChanges().catch(() => {});
    });
  }

  presetSync.startPeriodicSync();

  // Stream Deck config → Supabase bidirectional sync
  const streamDeckSync = new StreamDeckSyncService();
  streamDeckSync.initialize({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
    machineId: config.machineId,
    machineName: config.machineName,
    configFilePath: path.join(app.getPath('userData'), 'plugin-data', 'streamdeck-config.json'),
  });
  streamDeckSync.startPeriodicSync();

  // If sync source is configured, start a sync
  if (config.syncSourcePath) {
    syncEngine.runSync().catch(err => {
      console.error('[Launcher] Initial sync failed:', err);
    });
  }

  // Old Elgato SDK plugin installer removed — now using direct USB hardware control

  // Auto-updater: wire electron-updater events to renderer
  initAutoUpdater(mainWindow);

  // Silent auto-update on launch (packaged app only)
  if (app.isPackaged && config.autoUpdate) {
    silentAutoUpdate(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('before-quit', () => {
  // Stop the global key listener's native subprocess and HTTP server so
  // the process exits cleanly — prevents the macOS "quit unexpectedly" dialog.
  stopEmbeddedServer();
});

app.on('window-all-closed', () => {
  // On macOS keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Discover all Premiere Pro sync sources on this machine.
 * Scans for versioned directories and profile directories automatically.
 */
function discoverSyncSources(homeDir: string): SyncSource[] {
  const sources: SyncSource[] = [];

  const premiereDocsBase = path.join(homeDir, 'Documents', 'Adobe', 'Premiere Pro');
  const ameDocsBase = path.join(homeDir, 'Documents', 'Adobe', 'Adobe Media Encoder');

  // Find all Premiere Pro version + profile directories
  const profileDirs = findProfileDirs(premiereDocsBase);

  for (const { version, profileDir } of profileDirs) {
    const tag = version; // e.g. "25.0"

    // Keyboard Shortcuts — Mac subfolder contains .kys files
    const shortcutsDir = path.join(profileDir, 'Mac');
    sources.push({
      name: `keyboard-shortcuts-${tag}`,
      localDir: shortcutsDir,
      include: ['*.kys'],
    });

    // Workspaces — Layouts subfolder contains XML workspace files
    const layoutsDir = path.join(profileDir, 'Layouts');
    sources.push({
      name: `workspaces-${tag}`,
      localDir: layoutsDir,
      include: ['*.xml'],
    });

    // Effects Presets — single .prfpset file in profile dir
    sources.push({
      name: `effects-presets-${tag}`,
      localDir: profileDir,
      include: ['*.prfpset'],
    });
  }

  // Export Presets — Adobe Media Encoder PresetTree.xml
  const ameVersions = findVersionDirs(ameDocsBase);
  for (const ver of ameVersions) {
    const presetsDir = path.join(ameDocsBase, ver, 'Presets');
    sources.push({
      name: `export-presets-${ver}`,
      localDir: presetsDir,
      include: ['*.xml', '*.epr'],
    });
  }

  // Motion Graphics Templates — shared across all versions
  const mogrtsDir = path.join(
    homeDir, 'Library', 'Application Support', 'Adobe', 'Common', 'Motion Graphics Templates',
  );
  sources.push({
    name: 'graphics-templates',
    localDir: mogrtsDir,
    include: ['*.mogrt'],
  });

  // Excalibur macros — Knights of the Editing Table user data
  const excaliburDir = path.join(
    homeDir, 'Library', 'Application Support', 'Knights of the Editing Table',
  );
  sources.push({
    name: 'excalibur-macros',
    localDir: excaliburDir,
    include: ['*.json'],
  });

  // Excalibur scripts
  const excaliburScriptsDir = path.join(
    homeDir, 'Documents', 'Knights of the Editing Table', 'Excalibur', 'Scripts',
  );
  if (fs.existsSync(excaliburScriptsDir)) {
    sources.push({
      name: 'excalibur-scripts',
      localDir: excaliburScriptsDir,
    });
  }

  return sources;
}

/** Find all version directories (e.g. "24.0", "25.0") under a base path */
function findVersionDirs(basePath: string): string[] {
  if (!fs.existsSync(basePath)) return [];
  try {
    return fs.readdirSync(basePath, { withFileTypes: true })
      .filter(e => e.isDirectory() && /^\d+\.\d+$/.test(e.name))
      .map(e => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Find all Profile-* directories within versioned Premiere Pro directories */
function findProfileDirs(premiereBase: string): Array<{ version: string; profileDir: string }> {
  const results: Array<{ version: string; profileDir: string }> = [];
  const versions = findVersionDirs(premiereBase);

  for (const ver of versions) {
    const versionDir = path.join(premiereBase, ver);
    try {
      const entries = fs.readdirSync(versionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('Profile-')) {
          results.push({ version: ver, profileDir: path.join(versionDir, entry.name) });
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }

  return results;
}
