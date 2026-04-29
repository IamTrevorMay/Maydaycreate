import { app, BrowserWindow, shell, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { is } from '@electron-toolkit/utils';
import { loadConfig } from './config-store.js';
import { startEmbeddedServer, getServerBridge, stopEmbeddedServer } from './server-bridge.js';
import {
  registerIpcHandlers,
  setMainWindow,
  setYouTubeAnalyzer,
  registerYouTubeIpc,
  bridgeSyncEvents,
  bridgeServerEvents,
  bridgePluginEvents,
} from './ipc-handlers.js';
import { createTray, destroyTray } from './tray.js';
import { YouTubeAnalyzer } from './youtube/youtube-analyzer.js';
import { YouTubeSyncService } from './youtube/youtube-sync.js';
import { PresetSyncService } from './preset-sync.js';
import { StreamDeckSyncService } from './streamdeck-sync.js';
import { initAutoUpdater, silentAutoUpdate } from './auto-updater.js';
import { registerPluginScheme, registerPluginProtocolHandler } from './plugin-page-protocol.js';
// Old Elgato SDK plugin installer — replaced by direct USB hardware control
// import { installStreamDeckPlugin } from './stream-deck-installer.js';

// Prevent EPIPE crashes when stdout/stderr pipe is closed (e.g., dev tooling restart)
process.stdout?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});
process.stderr?.on?.('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') return;
  throw err;
});

// Augment PATH for Dock-launched apps (they don't inherit shell PATH)
if (app.isPackaged) {
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin'];
  const current = process.env.PATH || '';
  const missing = extraPaths.filter((p) => !current.includes(p));
  if (missing.length) {
    process.env.PATH = [...missing, current].join(':');
  }

  // Symlink app's node_modules into the plugins directory so ESM imports resolve
  // With asar enabled, real files are in app.asar.unpacked/; fall back to app/ for dev
  const unpackedNM = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
  const plainNM = path.join(process.resourcesPath, 'app', 'node_modules');
  const appNodeModules = fs.existsSync(unpackedNM) ? unpackedNM : plainNM;
  const pluginsNodeModules = path.join(process.resourcesPath, 'plugins', 'node_modules');
  if (fs.existsSync(appNodeModules) && !fs.existsSync(pluginsNodeModules)) {
    try {
      fs.symlinkSync(appNodeModules, pluginsNodeModules, 'dir');
    } catch {
      // If symlink fails (permissions), plugins will degrade gracefully
    }
  }

  // Set ESBUILD_BINARY_PATH before the server loads esbuild's module.
  // esbuild caches the env var at module load time, so it must be set early.
  if (fs.existsSync(unpackedNM)) {
    const esbuildBin = path.join(unpackedNM, '@esbuild', `${process.platform}-${process.arch}`, 'bin', 'esbuild');
    if (fs.existsSync(esbuildBin)) {
      process.env.ESBUILD_BINARY_PATH = esbuildBin;
    }

    // Add the asar's node_modules to NODE_PATH so unpacked packages can
    // resolve their CJS dependencies that remain inside the asar.
    const asarNM = path.join(process.resourcesPath, 'app.asar', 'node_modules');
    process.env.NODE_PATH = [asarNM, process.env.NODE_PATH].filter(Boolean).join(':');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('module').Module._initPaths();
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

// Must register custom scheme before app is ready
registerPluginScheme();

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

  // Register custom protocol for plugin UI pages (mayday-plugin://<plugin-id>/path)
  registerPluginProtocolHandler();

  const config = loadConfig();

  // Ensure login item matches config
  app.setLoginItemSettings({ openAtLogin: config.autoLaunchOnLogin });

  // Set API key from config (falls back to env var if not configured)
  if (config.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = config.anthropicApiKey;
  }

  // Set machine identity + sync config for plugins (premiere-pro-sync, etc.)
  process.env.MAYDAY_MACHINE_ID = config.machineId;
  process.env.MAYDAY_MACHINE_NAME = config.machineName;
  if (config.syncSourcePath) {
    process.env.MAYDAY_SYNC_SOURCE_PATH = config.syncSourcePath;
  }

  // YouTube analyzer
  const youtubeAnalyzer = new YouTubeAnalyzer();

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

  // Push plugin list to renderer now that server + plugins are ready
  bridgePluginEvents();


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
      presetSync.pushChanges().catch((err) => {
        console.error('[PresetSync] Push failed after preset-saved:', err);
      });
    });
    bridge.eventBus.on('plugin:preset-vault:preset-deleted', (event: { data?: { presetId?: string } }) => {
      presetSync.queueDelete(event.data?.presetId);
      presetSync.pushChanges().catch((err) => {
        console.error('[PresetSync] Push failed after preset-deleted:', err);
      });
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
  destroyTray();
  stopEmbeddedServer();
});

app.on('window-all-closed', () => {
  // On macOS keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

