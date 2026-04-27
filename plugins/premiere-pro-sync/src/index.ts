/**
 * Premiere Pro Sync Plugin
 *
 * Syncs Premiere Pro keyboard shortcuts, workspaces, effect presets,
 * export presets, motion graphics templates, and Excalibur configs
 * across machines via a shared folder (NAS/Dropbox/Google Drive).
 *
 * Extracted from launcher main process as part of the modular plugin architecture.
 */
import { definePlugin } from '@mayday/sdk';
import {
  SyncEngine,
  SyncWatcher,
  type SyncSource,
  type ConflictResolution,
  type HistorySnapshot,
} from '@mayday/sync-engine';
import path from 'path';
import fs from 'fs';
import os from 'os';

let engine: SyncEngine | null = null;
let watcher: SyncWatcher | null = null;

export default definePlugin({
  async activate(ctx) {
    // Config can come from plugin config (persisted in registry) or env vars (set by launcher)
    const syncSourcePath = (ctx.config.syncSourcePath as string) || process.env.MAYDAY_SYNC_SOURCE_PATH || '';
    const machineId = process.env.MAYDAY_MACHINE_ID || os.hostname();
    const machineName = process.env.MAYDAY_MACHINE_NAME || os.hostname();

    engine = new SyncEngine({
      syncSourcePath,
      machineId,
      machineName,
    });

    // Auto-discover sync sources
    const homeDir = os.homedir();
    const sources = discoverSyncSources(homeDir);
    for (const source of sources) {
      engine.addSyncSource(source);
    }
    ctx.log.info(`Configured ${sources.length} sync source(s): ${sources.map(s => s.name).join(', ')}`);

    // Start watching + initial sync if path configured
    if (syncSourcePath) {
      const autoSync = ctx.config.autoSync !== false;
      if (autoSync) {
        watcher = new SyncWatcher({ syncSourcePath, engine });
        watcher.start();
        ctx.log.info('File watcher started');
      }

      // Run initial sync
      try {
        await engine.runSync();
        ctx.log.info('Initial sync complete');
      } catch (err) {
        ctx.log.error('Initial sync failed:', err);
      }
    } else {
      ctx.log.info('No sync source path configured — sync disabled');
    }

    // Forward status changes as plugin events
    engine.onStatusChanged((status) => {
      ctx.ui.pushToPanel('sync-status', status);
    });
  },

  async deactivate(ctx) {
    if (watcher) {
      watcher.stop();
      watcher = null;
    }
    engine = null;
    ctx.log.info('Sync engine stopped');
  },

  commands: {
    'discover-sources': async () => {
      const homeDir = os.homedir();
      return discoverSyncSources(homeDir);
    },

    'run-sync': async () => {
      if (!engine) throw new Error('Sync engine not initialized');
      await engine.runSync();
    },

    'get-status': async () => {
      if (!engine) return { state: 'idle', pendingCount: 0, conflictCount: 0 };
      return engine.getStatus();
    },

    'get-conflicts': async () => {
      if (!engine) return [];
      return engine.getConflicts();
    },

    'resolve-conflict': async (_ctx, args) => {
      if (!engine) throw new Error('Sync engine not initialized');
      await engine.resolveConflict(args as ConflictResolution);
    },

    'get-sync-log': async () => {
      if (!engine) return [];
      return engine.getSyncLog();
    },

    'get-queue': async () => {
      if (!engine) return [];
      return engine.getQueue();
    },

    'flush-queue': async () => {
      if (!engine) throw new Error('Sync engine not initialized');
      await engine.flushQueue();
    },

    'create-snapshot': async () => {
      if (!engine) throw new Error('Sync engine not initialized');
      return engine.createSnapshot();
    },

    'list-snapshots': async () => {
      if (!engine) return [];
      return engine.listSnapshots();
    },

    'restore-snapshot': async (_ctx, args) => {
      if (!engine) throw new Error('Sync engine not initialized');
      engine.restoreSnapshot(args as HistorySnapshot);
    },
  },
});

// ── Sync Source Discovery ───────────────────────────────────────────────────

function discoverSyncSources(homeDir: string): SyncSource[] {
  const sources: SyncSource[] = [];

  const premiereDocsBase = path.join(homeDir, 'Documents', 'Adobe', 'Premiere Pro');
  const ameDocsBase = path.join(homeDir, 'Documents', 'Adobe', 'Adobe Media Encoder');

  // Find all Premiere Pro version + profile directories
  const profileDirs = findProfileDirs(premiereDocsBase);

  for (const { version, profileDir } of profileDirs) {
    const tag = version;

    // Keyboard Shortcuts
    const shortcutsDir = path.join(profileDir, 'Mac');
    sources.push({
      name: `keyboard-shortcuts-${tag}`,
      localDir: shortcutsDir,
      include: ['*.kys'],
    });

    // Workspaces
    const layoutsDir = path.join(profileDir, 'Layouts');
    sources.push({
      name: `workspaces-${tag}`,
      localDir: layoutsDir,
      include: ['*.xml'],
    });

    // Effects Presets
    sources.push({
      name: `effects-presets-${tag}`,
      localDir: profileDir,
      include: ['*.prfpset'],
    });
  }

  // Export Presets (Adobe Media Encoder)
  const ameVersions = findVersionDirs(ameDocsBase);
  for (const ver of ameVersions) {
    const presetsDir = path.join(ameDocsBase, ver, 'Presets');
    sources.push({
      name: `export-presets-${ver}`,
      localDir: presetsDir,
      include: ['*.xml', '*.epr'],
    });
  }

  // Motion Graphics Templates
  const mogrtsDir = path.join(
    homeDir, 'Library', 'Application Support', 'Adobe', 'Common', 'Motion Graphics Templates',
  );
  sources.push({
    name: 'graphics-templates',
    localDir: mogrtsDir,
    include: ['*.mogrt'],
  });

  // Excalibur macros
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
