import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { HistorySnapshot } from './types.js';

/**
 * Create a timestamped snapshot of the remote configs dir inside history/.
 * Uses fs.cpSync for a full copy (hardlinks not available cross-device).
 */
export function createSnapshot(
  syncSourcePath: string,
  machineId: string,
  machineName: string,
): HistorySnapshot {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
  const snapshotId = uuid();
  const snapshotDir = path.join(syncSourcePath, 'history', timestamp);
  const configsDir = path.join(syncSourcePath, 'configs');

  fs.mkdirSync(snapshotDir, { recursive: true });

  const files: string[] = [];

  if (fs.existsSync(configsDir)) {
    const destConfigs = path.join(snapshotDir, 'configs');
    fs.cpSync(configsDir, destConfigs, { recursive: true });

    // Collect file list
    collectFiles(destConfigs, destConfigs, files);
  }

  // Write snapshot manifest
  const snapshot: HistorySnapshot = {
    id: snapshotId,
    timestamp: new Date().toISOString(),
    machineId,
    machineName,
    snapshotPath: snapshotDir,
    files,
  };

  fs.writeFileSync(
    path.join(snapshotDir, 'snapshot.json'),
    JSON.stringify(snapshot, null, 2),
    'utf-8',
  );

  return snapshot;
}

/**
 * List all snapshots in the history directory, sorted newest-first.
 */
export function listSnapshots(syncSourcePath: string): HistorySnapshot[] {
  const historyDir = path.join(syncSourcePath, 'history');
  if (!fs.existsSync(historyDir)) return [];

  const entries = fs.readdirSync(historyDir, { withFileTypes: true });
  const snapshots: HistorySnapshot[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(historyDir, entry.name, 'snapshot.json');
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      snapshots.push(raw as HistorySnapshot);
    } catch {
      // Corrupt snapshot — skip
    }
  }

  return snapshots.sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/**
 * Restore a snapshot by copying its configs back to the sync source configs dir.
 */
export function restoreSnapshot(snapshot: HistorySnapshot, syncSourcePath: string): void {
  const snapshotConfigs = path.join(snapshot.snapshotPath, 'configs');
  const targetConfigs = path.join(syncSourcePath, 'configs');

  if (!fs.existsSync(snapshotConfigs)) {
    throw new Error(`Snapshot configs not found: ${snapshotConfigs}`);
  }

  // Back up current state before restore
  const backupDir = path.join(syncSourcePath, 'history', `pre-restore-${Date.now()}`);
  if (fs.existsSync(targetConfigs)) {
    fs.cpSync(targetConfigs, path.join(backupDir, 'configs'), { recursive: true });
  }

  // Overwrite configs with snapshot
  if (fs.existsSync(targetConfigs)) {
    fs.rmSync(targetConfigs, { recursive: true });
  }
  fs.cpSync(snapshotConfigs, targetConfigs, { recursive: true });
}

function collectFiles(dir: string, base: string, results: string[]): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(abs, base, results);
    } else {
      results.push(path.relative(base, abs));
    }
  }
}
