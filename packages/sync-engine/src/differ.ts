import type { FileDiff, SyncManifest } from './types.js';
import { buildFileMap, scanDirectory } from './scanner.js';
import type { ScanOptions } from './scanner.js';
import { isHardwareSpecific } from './hardware-filter.js';

export interface DiffOptions {
  localConfigsDir: string;
  remoteConfigsDir: string;
  manifest: SyncManifest;
  machineId: string;
  /** Optional include/exclude patterns passed through to the scanner */
  scanOptions?: ScanOptions;
}

/**
 * Compare local and remote configs directories and categorize each file.
 *
 * Conflict rule: conflict when
 *   localMtime > lastSyncedAt[machineId] AND
 *   remoteMtime > lastSyncedAt[machineId] AND
 *   contentHash differs
 */
export function diffDirectories(opts: DiffOptions): FileDiff[] {
  const { localConfigsDir, remoteConfigsDir, manifest, machineId } = opts;

  const lastSyncedStr = manifest.lastSyncedAt[machineId];
  const lastSyncedAt = lastSyncedStr ? new Date(lastSyncedStr).getTime() : 0;

  const localFiles = scanDirectory(localConfigsDir, undefined, opts.scanOptions);
  const remoteFiles = scanDirectory(remoteConfigsDir, undefined, opts.scanOptions);

  const localMap = buildFileMap(localFiles);
  const remoteMap = buildFileMap(remoteFiles);

  const allPaths = new Set([
    ...localMap.keys(),
    ...remoteMap.keys(),
  ]);

  const diffs: FileDiff[] = [];

  for (const relPath of allPaths) {
    if (isHardwareSpecific(relPath)) continue;

    const local = localMap.get(relPath);
    const remote = remoteMap.get(relPath);

    if (local && !remote) {
      diffs.push({
        relativePath: relPath,
        state: 'local-only',
        localPath: local.absolutePath,
        localMtime: local.mtime,
        localHash: local.hash,
      });
      continue;
    }

    if (!local && remote) {
      diffs.push({
        relativePath: relPath,
        state: 'remote-only',
        remotePath: remote.absolutePath,
        remoteMtime: remote.mtime,
        remoteHash: remote.hash,
      });
      continue;
    }

    if (!local || !remote) continue;

    if (local.hash === remote.hash) {
      diffs.push({
        relativePath: relPath,
        state: 'up-to-date',
        localPath: local.absolutePath,
        remotePath: remote.absolutePath,
        localMtime: local.mtime,
        remoteMtime: remote.mtime,
        localHash: local.hash,
        remoteHash: remote.hash,
      });
      continue;
    }

    const localChanged = local.mtime > lastSyncedAt;
    const remoteChanged = remote.mtime > lastSyncedAt;

    if (localChanged && remoteChanged) {
      diffs.push({
        relativePath: relPath,
        state: 'conflict',
        localPath: local.absolutePath,
        remotePath: remote.absolutePath,
        localMtime: local.mtime,
        remoteMtime: remote.mtime,
        localHash: local.hash,
        remoteHash: remote.hash,
      });
    } else if (remoteChanged) {
      diffs.push({
        relativePath: relPath,
        state: 'needs-pull',
        localPath: local.absolutePath,
        remotePath: remote.absolutePath,
        localMtime: local.mtime,
        remoteMtime: remote.mtime,
        localHash: local.hash,
        remoteHash: remote.hash,
      });
    } else {
      diffs.push({
        relativePath: relPath,
        state: 'needs-push',
        localPath: local.absolutePath,
        remotePath: remote.absolutePath,
        localMtime: local.mtime,
        remoteMtime: remote.mtime,
        localHash: local.hash,
        remoteHash: remote.hash,
      });
    }
  }

  return diffs;
}
