import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { is } from '@electron-toolkit/utils';

const STREAM_DECK_PLUGINS_DIR = path.join(
  app.getPath('home'),
  'Library',
  'Application Support',
  'com.elgato.StreamDeck',
  'Plugins',
);
const PLUGIN_NAME = 'com.mayday.excalibur.sdPlugin';

/**
 * Install or update the Excalibur Stream Deck plugin.
 * Copies the .sdPlugin folder to the Stream Deck plugins directory.
 * Only installs if Stream Deck is present on the system.
 */
export function installStreamDeckPlugin(): void {
  try {
    // Check if Stream Deck is installed
    if (!fs.existsSync(STREAM_DECK_PLUGINS_DIR)) {
      console.log('[StreamDeck] Stream Deck plugins directory not found, skipping install');
      return;
    }

    // Find the source .sdPlugin directory
    const sourcePath = resolvePluginSource();
    if (!sourcePath) {
      console.log('[StreamDeck] Plugin source not found, skipping install');
      return;
    }

    const destPath = path.join(STREAM_DECK_PLUGINS_DIR, PLUGIN_NAME);

    // Read source manifest version
    const sourceManifest = readManifest(path.join(sourcePath, 'manifest.json'));
    if (!sourceManifest) {
      console.log('[StreamDeck] Could not read source manifest');
      return;
    }

    // Check if already installed and up-to-date
    const destManifest = readManifest(path.join(destPath, 'manifest.json'));
    if (destManifest && destManifest.Version === sourceManifest.Version) {
      console.log(`[StreamDeck] Plugin already installed (v${sourceManifest.Version})`);
      return;
    }

    // Copy plugin directory
    copyDirRecursive(sourcePath, destPath);
    console.log(`[StreamDeck] Installed ${PLUGIN_NAME} v${sourceManifest.Version}`);
  } catch (err) {
    console.error('[StreamDeck] Install error:', err);
  }
}

function resolvePluginSource(): string | null {
  if (is.dev) {
    // Dev mode: use monorepo path
    const devPath = path.resolve(
      app.getAppPath(),
      '../../plugins/stream-deck-excalibur',
      PLUGIN_NAME,
    );
    if (fs.existsSync(devPath)) return devPath;
  } else {
    // Packaged: plugins are bundled in resources
    const packagedPath = path.join(process.resourcesPath, 'plugins', 'stream-deck-excalibur', PLUGIN_NAME);
    if (fs.existsSync(packagedPath)) return packagedPath;
  }

  return null;
}

function readManifest(manifestPath: string): { Version: string } | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  // Remove existing destination
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
