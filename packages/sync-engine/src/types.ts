/** Core types for the Mayday sync engine */

export interface SyncConfig {
  syncSourcePath: string;
  machineId: string;
  machineName: string;
}

/**
 * A named local directory to sync. Each source maps to its own
 * subfolder inside the remote configs dir (syncSourcePath/configs/<name>/).
 */
export interface SyncSource {
  /** Identifier used as subfolder name in remote, e.g. "keyboard-shortcuts" */
  name: string;
  /** Absolute path to the local directory */
  localDir: string;
  /** Optional glob patterns — only sync files matching these (e.g. ["*.kys"]) */
  include?: string[];
  /** Optional glob patterns — skip files matching these */
  exclude?: string[];
}

export interface SyncManifest {
  schemaVersion: number;
  machines: MachineRecord[];
  /** ISO timestamp per machineId, keyed by machineId */
  lastSyncedAt: Record<string, string>;
}

export interface MachineRecord {
  id: string;
  name: string;
  lastSeen: string;
}

export interface SyncedFile {
  /** Relative path from configs/ root */
  relativePath: string;
  localPath: string;
  remotePath: string;
  localMtime: number;
  remoteMtime: number;
  localHash: string;
  remoteHash: string;
}

export type FileSyncState =
  | 'up-to-date'
  | 'needs-pull'
  | 'needs-push'
  | 'conflict'
  | 'local-only'
  | 'remote-only';

export interface FileDiff {
  relativePath: string;
  state: FileSyncState;
  localPath?: string;
  remotePath?: string;
  localMtime?: number;
  remoteMtime?: number;
  localHash?: string;
  remoteHash?: string;
}

export interface SyncConflict {
  relativePath: string;
  localPath: string;
  remotePath: string;
  localMtime: number;
  remoteMtime: number;
  localContent?: string;
  remoteContent?: string;
  localMachineName: string;
  remoteMachineNames: string[];
}

export interface ConflictResolution {
  relativePath: string;
  choice: 'keep-mine' | 'use-theirs';
}

export interface HistorySnapshot {
  id: string;
  timestamp: string;
  machineId: string;
  machineName: string;
  snapshotPath: string;
  files: string[];
}

export interface OfflineQueueEntry {
  id: string;
  timestamp: string;
  operation: 'push';
  relativePath: string;
  localPath: string;
  localHash: string;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error' | 'offline';
  lastSyncedAt?: string;
  lastSyncMachine?: string;
  pendingCount: number;
  conflictCount: number;
  errorMessage?: string;
  /** Summary of what happened in the last sync */
  lastSyncSummary?: string;
}

export interface SyncLogEntry {
  timestamp: string;
  machineId: string;
  machineName: string;
  summary: string;
  filesChecked: number;
  pushed: number;
  pulled: number;
  conflicts: number;
}

export interface MigrationProgress {
  phase: 'copying' | 'verifying' | 'switching' | 'done' | 'error';
  filesTotal: number;
  filesDone: number;
  errorMessage?: string;
}
