import fs from 'fs';
import path from 'path';
import type {
  SyncConfig,
  SyncManifest,
  SyncConflict,
  ConflictResolution,
  SyncStatus,
  SyncLogEntry,
  SyncSource,
  HistorySnapshot,
  OfflineQueueEntry,
} from './types.js';
import type { FileDiff } from './types.js';
import { diffDirectories } from './differ.js';
import { applyChanges, resolveConflict } from './merger.js';
import { createSnapshot, listSnapshots, restoreSnapshot } from './history.js';
import { readQueue, clearQueue } from './queue.js';

const MANIFEST_VERSION = 1;

function getManifestPath(syncSourcePath: string): string {
  return path.join(syncSourcePath, 'manifest.json');
}

function loadManifest(syncSourcePath: string): SyncManifest {
  const manifestPath = getManifestPath(syncSourcePath);
  if (!fs.existsSync(manifestPath)) {
    return { schemaVersion: MANIFEST_VERSION, machines: [], lastSyncedAt: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as SyncManifest;
  } catch {
    return { schemaVersion: MANIFEST_VERSION, machines: [], lastSyncedAt: {} };
  }
}

function saveManifest(syncSourcePath: string, manifest: SyncManifest): void {
  fs.mkdirSync(syncSourcePath, { recursive: true });
  fs.writeFileSync(getManifestPath(syncSourcePath), JSON.stringify(manifest, null, 2), 'utf-8');
}

function isSyncSourceAvailable(syncSourcePath: string): boolean {
  return fs.existsSync(syncSourcePath);
}

const MAX_LOG_ENTRIES = 50;

function getSyncLogPath(syncSourcePath: string): string {
  return path.join(syncSourcePath, 'sync-log.json');
}

function readSyncLog(syncSourcePath: string): SyncLogEntry[] {
  const logPath = getSyncLogPath(syncSourcePath);
  if (!fs.existsSync(logPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(logPath, 'utf-8')) as SyncLogEntry[];
  } catch {
    return [];
  }
}

function appendSyncLog(syncSourcePath: string, entry: SyncLogEntry): void {
  const log = readSyncLog(syncSourcePath);
  log.unshift(entry); // newest first
  if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
  fs.writeFileSync(getSyncLogPath(syncSourcePath), JSON.stringify(log, null, 2), 'utf-8');
}

export class SyncEngine {
  private config: SyncConfig;
  private status: SyncStatus = {
    state: 'idle',
    pendingCount: 0,
    conflictCount: 0,
  };
  private lastDiffs: FileDiff[] = [];
  private statusListeners: Array<(status: SyncStatus) => void> = [];
  private _syncSources: SyncSource[] = [];

  // Legacy fallback — kept for backwards compat
  private _localConfigsDir = '';

  constructor(config: SyncConfig) {
    this.config = config;
  }

  /**
   * Add a sync source. Each source syncs its local directory to
   * <syncSourcePath>/configs/<source.name>/ in the remote.
   */
  addSyncSource(source: SyncSource): void {
    // Avoid duplicates
    if (this._syncSources.some(s => s.name === source.name)) return;
    this._syncSources.push(source);
  }

  /**
   * Legacy: set a single local configs directory. Creates a default
   * sync source named "premiere-prefs".
   */
  setLocalConfigsDir(dir: string): void {
    this._localConfigsDir = dir;
    // Also add as a sync source for backwards compat
    this.addSyncSource({ name: 'premiere-prefs', localDir: dir });
  }

  /** Get all configured sync sources */
  getSyncSources(): SyncSource[] {
    return [...this._syncSources];
  }

  private get remoteConfigsDir(): string {
    return path.join(this.config.syncSourcePath, 'configs');
  }

  onStatusChanged(listener: (status: SyncStatus) => void): { unsubscribe(): void } {
    this.statusListeners.push(listener);
    return {
      unsubscribe: () => {
        this.statusListeners = this.statusListeners.filter(l => l !== listener);
      },
    };
  }

  private emitStatus(): void {
    for (const l of this.statusListeners) l(this.status);
  }

  private setStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    this.emitStatus();
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  async runSync(): Promise<void> {
    if (this._syncSources.length === 0) {
      this.setStatus({ state: 'error', errorMessage: 'No sync sources configured. Call addSyncSource() first.' });
      return;
    }

    if (!isSyncSourceAvailable(this.config.syncSourcePath)) {
      this.setStatus({ state: 'offline', errorMessage: 'Sync source unavailable' });
      return;
    }

    console.log(`[Sync] Starting sync with ${this._syncSources.length} source(s)...`);
    this.setStatus({ state: 'syncing', errorMessage: undefined });

    try {
      const manifest = loadManifest(this.config.syncSourcePath);

      // Ensure this machine is registered
      const machineIdx = manifest.machines.findIndex(m => m.id === this.config.machineId);
      if (machineIdx === -1) {
        manifest.machines.push({
          id: this.config.machineId,
          name: this.config.machineName,
          lastSeen: new Date().toISOString(),
        });
      } else {
        manifest.machines[machineIdx].lastSeen = new Date().toISOString();
      }

      // Aggregate diffs and merge results across all sources
      let allDiffs: FileDiff[] = [];
      let totalPushed = 0;
      let totalPulled = 0;
      let totalConflicts = 0;
      let totalFiles = 0;

      for (const source of this._syncSources) {
        // Skip sources whose local dir doesn't exist yet — nothing to sync
        if (!fs.existsSync(source.localDir)) {
          console.log(`[Sync]   ${source.name}: local dir missing (${source.localDir}) — skipping`);
          continue;
        }

        const remoteDir = path.join(this.remoteConfigsDir, source.name);

        console.log(`[Sync]   ${source.name}:`);
        console.log(`[Sync]     local:  ${source.localDir}`);
        console.log(`[Sync]     remote: ${remoteDir}`);

        const diffs = diffDirectories({
          localConfigsDir: source.localDir,
          remoteConfigsDir: remoteDir,
          manifest,
          machineId: this.config.machineId,
          scanOptions: {
            include: source.include,
            exclude: source.exclude,
          },
        });

        const conflicts = diffs.filter(d => d.state === 'conflict');
        const pending = diffs.filter(d => d.state === 'needs-push' || d.state === 'local-only');
        const pulled = diffs.filter(d => d.state === 'needs-pull' || d.state === 'remote-only');
        const upToDate = diffs.filter(d => d.state === 'up-to-date');

        console.log(`[Sync]     ${diffs.length} files — ${upToDate.length} up-to-date, ${pending.length} to push, ${pulled.length} to pull, ${conflicts.length} conflicts`);

        // Apply changes with un-prefixed relativePaths so merger resolves paths correctly
        const mergeResult = await applyChanges(diffs, source.localDir, remoteDir);

        // Now prefix relative paths with source name for uniqueness in the aggregated list
        for (const d of diffs) {
          d.relativePath = `${source.name}/${d.relativePath}`;
        }

        // Mark successfully synced files as up-to-date so pending count is accurate
        const pushedSet = new Set(mergeResult.pushed);
        const pulledSet = new Set(mergeResult.pulled);
        for (const d of diffs) {
          if ((d.state === 'needs-push' || d.state === 'local-only') && pushedSet.has(d.relativePath)) {
            d.state = 'up-to-date';
          } else if ((d.state === 'needs-pull' || d.state === 'remote-only') && pulledSet.has(d.relativePath)) {
            d.state = 'up-to-date';
          }
        }

        totalPushed += mergeResult.pushed.length;
        totalPulled += mergeResult.pulled.length;
        totalConflicts += conflicts.length;
        totalFiles += diffs.length;
        allDiffs = allDiffs.concat(diffs);
      }

      this.lastDiffs = allDiffs;

      // Update lastSyncedAt
      manifest.lastSyncedAt[this.config.machineId] = new Date().toISOString();
      saveManifest(this.config.syncSourcePath, manifest);

      // Build human-readable summary
      const parts: string[] = [];
      if (totalPushed) parts.push(`${totalPushed} pushed`);
      if (totalPulled) parts.push(`${totalPulled} pulled`);
      if (totalConflicts) parts.push(`${totalConflicts} conflicts`);
      const summary = parts.length > 0
        ? parts.join(', ')
        : `${totalFiles} files checked — all up to date`;

      // Append to shared sync log
      appendSyncLog(this.config.syncSourcePath, {
        timestamp: manifest.lastSyncedAt[this.config.machineId],
        machineId: this.config.machineId,
        machineName: this.config.machineName,
        summary,
        filesChecked: totalFiles,
        pushed: totalPushed,
        pulled: totalPulled,
        conflicts: totalConflicts,
      });

      this.setStatus({
        state: 'idle',
        lastSyncedAt: manifest.lastSyncedAt[this.config.machineId],
        lastSyncMachine: this.config.machineName,
        pendingCount: allDiffs.filter(d => d.state === 'needs-push' || d.state === 'local-only').length,
        conflictCount: totalConflicts,
        lastSyncSummary: summary,
      });
      console.log(`[Sync] Complete: ${summary}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Sync] Error:`, msg);
      this.setStatus({ state: 'error', errorMessage: msg });
    }
  }

  getConflicts(): SyncConflict[] {
    return this.lastDiffs
      .filter(d => d.state === 'conflict')
      .map(d => ({
        relativePath: d.relativePath,
        localPath: d.localPath!,
        remotePath: d.remotePath!,
        localMtime: d.localMtime!,
        remoteMtime: d.remoteMtime!,
        localMachineName: this.config.machineName,
        remoteMachineNames: this.getRemoteMachineNames(),
      }));
  }

  private getRemoteMachineNames(): string[] {
    const manifest = loadManifest(this.config.syncSourcePath);
    return manifest.machines
      .filter(m => m.id !== this.config.machineId)
      .map(m => m.name);
  }

  async resolveConflict(resolution: ConflictResolution): Promise<void> {
    // Find which source this conflict belongs to
    const sourceName = resolution.relativePath.split('/')[0];
    const source = this._syncSources.find(s => s.name === sourceName);
    if (!source) {
      throw new Error(`Unknown sync source: ${sourceName}`);
    }
    const remoteDir = path.join(this.remoteConfigsDir, source.name);
    // Strip the source prefix from the relativePath for the actual file operation
    const innerPath = resolution.relativePath.slice(sourceName.length + 1);
    resolveConflict({ ...resolution, relativePath: innerPath }, source.localDir, remoteDir);
    await this.runSync();
  }

  getSyncLog(limit = 10): SyncLogEntry[] {
    if (!isSyncSourceAvailable(this.config.syncSourcePath)) return [];
    return readSyncLog(this.config.syncSourcePath).slice(0, limit);
  }

  getQueue(): OfflineQueueEntry[] {
    if (!isSyncSourceAvailable(this.config.syncSourcePath)) return [];
    return readQueue(this.config.syncSourcePath);
  }

  async flushQueue(): Promise<void> {
    await this.runSync();
    clearQueue(this.config.syncSourcePath);
  }

  // History

  createSnapshot(): HistorySnapshot {
    return createSnapshot(
      this.config.syncSourcePath,
      this.config.machineId,
      this.config.machineName,
    );
  }

  listSnapshots(): HistorySnapshot[] {
    return listSnapshots(this.config.syncSourcePath);
  }

  restoreSnapshot(snapshot: HistorySnapshot): void {
    restoreSnapshot(snapshot, this.config.syncSourcePath);
  }
}
