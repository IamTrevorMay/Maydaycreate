import fs from 'fs';
import path from 'path';
import type { FileDiff, ConflictResolution } from './types.js';

export interface MergeResult {
  pulled: string[];
  pushed: string[];
  skippedConflicts: string[];
}

/**
 * Apply non-conflicting changes between local and remote.
 * Conflicts are left untouched until explicitly resolved.
 */
export async function applyChanges(
  diffs: FileDiff[],
  localConfigsDir: string,
  remoteConfigsDir: string,
): Promise<MergeResult> {
  const result: MergeResult = { pulled: [], pushed: [], skippedConflicts: [] };

  for (const diff of diffs) {
    const localTarget = path.join(localConfigsDir, diff.relativePath);
    const remoteTarget = path.join(remoteConfigsDir, diff.relativePath);

    switch (diff.state) {
      case 'needs-pull':
      case 'remote-only': {
        fs.mkdirSync(path.dirname(localTarget), { recursive: true });
        fs.copyFileSync(diff.remotePath!, localTarget);
        result.pulled.push(diff.relativePath);
        break;
      }
      case 'needs-push':
      case 'local-only': {
        fs.mkdirSync(path.dirname(remoteTarget), { recursive: true });
        fs.copyFileSync(diff.localPath!, remoteTarget);
        result.pushed.push(diff.relativePath);
        break;
      }
      case 'conflict': {
        result.skippedConflicts.push(diff.relativePath);
        break;
      }
      case 'up-to-date':
        break;
    }
  }

  return result;
}

/**
 * Apply a single conflict resolution.
 */
export function resolveConflict(
  resolution: ConflictResolution,
  localConfigsDir: string,
  remoteConfigsDir: string,
): void {
  const localPath = path.join(localConfigsDir, resolution.relativePath);
  const remotePath = path.join(remoteConfigsDir, resolution.relativePath);

  if (resolution.choice === 'keep-mine') {
    fs.mkdirSync(path.dirname(remotePath), { recursive: true });
    fs.copyFileSync(localPath, remotePath);
  } else {
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.copyFileSync(remotePath, localPath);
  }
}
