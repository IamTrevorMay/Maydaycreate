/**
 * Plugin Manager — downloads, installs, updates, and uninstalls plugins
 * from GitHub Releases.
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import { execSync } from 'child_process';
import {
  loadConfig,
  getInstalledPlugins,
  getInstalledPlugin,
  addInstalledPlugin,
  removeInstalledPlugin,
  updateInstalledPlugin,
  getExternalPluginsDir,
  getCepExtensionsDir,
} from './config-store.js';
import { getServerBridge } from './server-bridge.js';
import type {
  InstalledPluginRecord,
  AvailablePluginInfo,
  PluginCompatibilityManifest,
  PluginInstallProgress,
  PluginManifest,
} from '@mayday/types';

// ── Compatibility manifest ──────────────────────────────────────────────────

let _compatManifest: PluginCompatibilityManifest | null = null;

export function loadCompatibilityManifest(): PluginCompatibilityManifest {
  if (_compatManifest) return _compatManifest;

  // Look in the app's resources first (packaged), then the repo root (dev)
  const candidates = [
    path.join(process.resourcesPath ?? '', 'plugin-compatibility.json'),
    path.join(app.getAppPath(), 'plugin-compatibility.json'),
    path.join(app.getAppPath(), '../../plugin-compatibility.json'),
  ];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        _compatManifest = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
        return _compatManifest!;
      }
    } catch {
      // Try next candidate
    }
  }

  // Fallback: empty manifest
  _compatManifest = { sdkVersion: '1.0.0', plugins: {} };
  return _compatManifest;
}

// ── Available plugins ───────────────────────────────────────────────────────

export function getAvailablePlugins(): AvailablePluginInfo[] {
  const compat = loadCompatibilityManifest();
  const installed = getInstalledPlugins();

  return Object.entries(compat.plugins).map(([id, entry]) => {
    const record = installed.find(p => p.id === id);
    return {
      id,
      repository: entry.repository,
      compatible: entry.compatible,
      recommended: entry.recommended,
      description: entry.description,
      installed: !!record,
      installedVersion: record?.version,
    };
  });
}

// ── GitHub Release helpers ──────────────────────────────────────────────────

interface GitHubRelease {
  tag_name: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

function getGhToken(): string {
  return loadConfig().ghToken || process.env.GITHUB_TOKEN || '';
}

async function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'MaydayCreate-PluginManager',
      'Accept': 'application/vnd.github+json',
    };
    const token = getGhToken();
    if (token) headers['Authorization'] = `token ${token}`;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
    };

    https.get(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        fetchJson<T>(res.headers.location!).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`GitHub API ${res.statusCode}: ${url}`));
        res.resume();
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Invalid JSON from ${url}`));
        }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      'User-Agent': 'MaydayCreate-PluginManager',
      'Accept': 'application/octet-stream',
    };
    const token = getGhToken();
    if (token) headers['Authorization'] = `token ${token}`;

    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers,
    };

    https.get(options, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // GitHub redirects asset downloads — follow without auth header
        downloadFile(res.headers.location!, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed ${res.statusCode}: ${url}`));
        res.resume();
        return;
      }

      const file = createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    }).on('error', reject);
  });
}

export async function getLatestRelease(repository: string): Promise<GitHubRelease> {
  return fetchJson<GitHubRelease>(
    `https://api.github.com/repos/${repository}/releases/latest`,
  );
}

// ── Install ─────────────────────────────────────────────────────────────────

export async function installPlugin(
  pluginId: string,
  onProgress?: (progress: PluginInstallProgress) => void,
): Promise<void> {
  const compat = loadCompatibilityManifest();
  const entry = compat.plugins[pluginId];
  if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

  // Check if already installed
  if (getInstalledPlugin(pluginId)) {
    throw new Error(`Plugin ${pluginId} is already installed. Use update instead.`);
  }

  onProgress?.({ phase: 'downloading', message: `Fetching latest release for ${pluginId}...` });

  const release = await getLatestRelease(entry.repository);
  const version = release.tag_name.replace(/^v/, '');

  // Find zip asset
  const asset = release.assets.find(a => a.name.endsWith('.zip'));
  if (!asset) throw new Error(`No zip asset in release ${release.tag_name} of ${entry.repository}`);

  // Download to temp
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mayday-plugin-'));
  const zipPath = path.join(tmpDir, asset.name);

  try {
    onProgress?.({ phase: 'downloading', message: `Downloading ${asset.name}...`, pluginId });
    await downloadFile(asset.browser_download_url, zipPath);

    onProgress?.({ phase: 'extracting', message: 'Extracting plugin...', pluginId });

    // Extract zip
    const pluginsDir = getExternalPluginsDir();
    const pluginDir = path.join(pluginsDir, pluginId);
    fs.mkdirSync(pluginDir, { recursive: true });

    // Use system unzip (macOS)
    execSync(`unzip -o "${zipPath}" -d "${pluginDir}"`, { stdio: 'pipe' });

    // Verify mayday.json exists
    const manifestPath = path.join(pluginDir, 'mayday.json');
    if (!fs.existsSync(manifestPath)) {
      // Check if files are nested in a subdirectory (common with GitHub releases)
      const entries = fs.readdirSync(pluginDir);
      if (entries.length === 1 && fs.statSync(path.join(pluginDir, entries[0])).isDirectory()) {
        // Move contents up one level
        const nested = path.join(pluginDir, entries[0]);
        for (const item of fs.readdirSync(nested)) {
          fs.renameSync(path.join(nested, item), path.join(pluginDir, item));
        }
        fs.rmdirSync(nested);
      }
    }

    if (!fs.existsSync(path.join(pluginDir, 'mayday.json'))) {
      throw new Error('Downloaded plugin does not contain mayday.json');
    }

    // Read manifest for hasCep
    const manifest: PluginManifest = JSON.parse(
      fs.readFileSync(path.join(pluginDir, 'mayday.json'), 'utf-8'),
    );

    // Install CEP extension if present
    let cepInstalled = false;
    const cepDir = path.join(pluginDir, 'cep');
    if (manifest.hasCep && fs.existsSync(cepDir)) {
      onProgress?.({ phase: 'installing', message: 'Installing CEP extension...', pluginId });
      installCepExtension(pluginId, version, cepDir);
      cepInstalled = true;
    }

    // Track in config
    addInstalledPlugin({
      id: pluginId,
      version,
      repository: entry.repository,
      installedAt: Date.now(),
      cepInstalled,
    });

    // Load and activate in the running server
    onProgress?.({ phase: 'activating', message: 'Activating plugin...', pluginId });
    const bridge = getServerBridge();
    if (bridge) {
      const mainPath = path.join(pluginDir, manifest.main);
      await bridge.lifecycle.loadPlugin(manifest, mainPath);
      await bridge.lifecycle.activatePlugin(pluginId);
    }

    onProgress?.({ phase: 'done', message: `${manifest.name} v${version} installed`, pluginId });
  } finally {
    // Clean up temp
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Update ──────────────────────────────────────────────────────────────────

export async function updatePlugin(
  pluginId: string,
  onProgress?: (progress: PluginInstallProgress) => void,
): Promise<void> {
  const record = getInstalledPlugin(pluginId);
  if (!record) throw new Error(`Plugin ${pluginId} is not installed`);

  const compat = loadCompatibilityManifest();
  const entry = compat.plugins[pluginId];
  if (!entry) throw new Error(`Unknown plugin: ${pluginId}`);

  onProgress?.({ phase: 'downloading', message: `Checking for updates...`, pluginId });

  const release = await getLatestRelease(entry.repository);
  const newVersion = release.tag_name.replace(/^v/, '');

  if (newVersion === record.version) {
    onProgress?.({ phase: 'done', message: 'Already up to date', pluginId });
    return;
  }

  const asset = release.assets.find(a => a.name.endsWith('.zip'));
  if (!asset) throw new Error(`No zip asset in release ${release.tag_name}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mayday-plugin-'));
  const zipPath = path.join(tmpDir, asset.name);

  try {
    onProgress?.({ phase: 'downloading', message: `Downloading ${asset.name}...`, pluginId });
    await downloadFile(asset.browser_download_url, zipPath);

    // Deactivate the running plugin
    const bridge = getServerBridge();
    if (bridge) {
      try {
        await bridge.lifecycle.deactivatePlugin(pluginId);
      } catch {
        // May not be active
      }
    }

    onProgress?.({ phase: 'extracting', message: 'Extracting update...', pluginId });

    // Replace plugin files
    const pluginsDir = getExternalPluginsDir();
    const pluginDir = path.join(pluginsDir, pluginId);
    fs.rmSync(pluginDir, { recursive: true, force: true });
    fs.mkdirSync(pluginDir, { recursive: true });

    execSync(`unzip -o "${zipPath}" -d "${pluginDir}"`, { stdio: 'pipe' });

    // Handle nested directory from zip
    const manifestPath = path.join(pluginDir, 'mayday.json');
    if (!fs.existsSync(manifestPath)) {
      const entries = fs.readdirSync(pluginDir);
      if (entries.length === 1 && fs.statSync(path.join(pluginDir, entries[0])).isDirectory()) {
        const nested = path.join(pluginDir, entries[0]);
        for (const item of fs.readdirSync(nested)) {
          fs.renameSync(path.join(nested, item), path.join(pluginDir, item));
        }
        fs.rmdirSync(nested);
      }
    }

    const manifest: PluginManifest = JSON.parse(
      fs.readFileSync(path.join(pluginDir, 'mayday.json'), 'utf-8'),
    );

    // Update CEP extension (version-suffixed for Premiere cache busting)
    let cepInstalled = false;
    const cepDir = path.join(pluginDir, 'cep');
    if (manifest.hasCep && fs.existsSync(cepDir)) {
      onProgress?.({ phase: 'installing', message: 'Updating CEP extension...', pluginId });
      // Remove old version
      uninstallCepExtension(pluginId);
      // Install new version
      installCepExtension(pluginId, newVersion, cepDir);
      cepInstalled = true;
    }

    // Update tracking
    updateInstalledPlugin(pluginId, {
      version: newVersion,
      cepInstalled,
    });

    // Reload in server
    onProgress?.({ phase: 'activating', message: 'Activating updated plugin...', pluginId });
    if (bridge) {
      const mainPath = path.join(pluginDir, manifest.main);
      await bridge.lifecycle.loadPlugin(manifest, mainPath, true);
      await bridge.lifecycle.activatePlugin(pluginId);
    }

    onProgress?.({
      phase: 'done',
      message: `Updated to v${newVersion}${cepInstalled ? ' (restart Premiere for panel update)' : ''}`,
      pluginId,
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Uninstall ───────────────────────────────────────────────────────────────

export async function uninstallPlugin(pluginId: string): Promise<void> {
  const record = getInstalledPlugin(pluginId);
  if (!record) throw new Error(`Plugin ${pluginId} is not installed`);

  // Deactivate
  const bridge = getServerBridge();
  if (bridge) {
    try {
      await bridge.lifecycle.deactivatePlugin(pluginId);
    } catch {
      // May not be active
    }
  }

  // Remove plugin files
  const pluginDir = path.join(getExternalPluginsDir(), pluginId);
  fs.rmSync(pluginDir, { recursive: true, force: true });

  // Remove CEP extension
  if (record.cepInstalled) {
    uninstallCepExtension(pluginId);
  }

  // Remove from config
  removeInstalledPlugin(pluginId);
}

// ── Check for updates ───────────────────────────────────────────────────────

export interface PluginUpdateInfo {
  pluginId: string;
  currentVersion: string;
  latestVersion: string;
  repository: string;
}

export async function checkForPluginUpdates(): Promise<PluginUpdateInfo[]> {
  const installed = getInstalledPlugins();
  if (installed.length === 0) return [];

  const updates: PluginUpdateInfo[] = [];

  for (const record of installed) {
    try {
      const release = await getLatestRelease(record.repository);
      const latestVersion = release.tag_name.replace(/^v/, '');
      if (latestVersion !== record.version) {
        updates.push({
          pluginId: record.id,
          currentVersion: record.version,
          latestVersion,
          repository: record.repository,
        });
      }
    } catch (err) {
      console.warn(`[PluginManager] Failed to check updates for ${record.id}:`, err);
    }
  }

  return updates;
}

// ── CEP extension helpers ───────────────────────────────────────────────────

function installCepExtension(pluginId: string, version: string, sourceCepDir: string): void {
  const extensionsDir = getCepExtensionsDir();
  // Use version-suffixed folder to bust Premiere's extension cache
  const extId = `com.mayday.${pluginId}.v${version}`;
  const destDir = path.join(extensionsDir, extId);

  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(sourceCepDir, destDir, { recursive: true });
}

function uninstallCepExtension(pluginId: string): void {
  const extensionsDir = getCepExtensionsDir();
  // Remove all version-suffixed folders for this plugin
  try {
    const entries = fs.readdirSync(extensionsDir);
    const prefix = `com.mayday.${pluginId}`;
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        fs.rmSync(path.join(extensionsDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    // Extensions dir may not exist
  }
}
