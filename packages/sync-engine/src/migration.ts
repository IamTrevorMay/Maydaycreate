import fs from 'fs';
import path from 'path';
import { hashFile, scanDirectory } from './scanner.js';
import type { MigrationProgress } from './types.js';

export type MigrationProgressCallback = (progress: MigrationProgress) => void;

/**
 * 3-phase migration: copy → verify → switch the sync source path.
 *
 * 1. Copy all files from oldPath to newPath
 * 2. Verify hashes match
 * 3. Update the launcher config to use newPath
 *
 * Returns the new path on success. Throws on verification failure.
 */
export async function migrateSyncSource(
  oldPath: string,
  newPath: string,
  onProgress: MigrationProgressCallback,
): Promise<void> {
  // Phase 1: Copy
  const files = scanDirectory(oldPath);
  const total = files.length;

  onProgress({ phase: 'copying', filesTotal: total, filesDone: 0 });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const destPath = path.join(newPath, path.relative(oldPath, file.absolutePath));
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(file.absolutePath, destPath);
    onProgress({ phase: 'copying', filesTotal: total, filesDone: i + 1 });
  }

  // Phase 2: Verify
  onProgress({ phase: 'verifying', filesTotal: total, filesDone: 0 });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const destPath = path.join(newPath, path.relative(oldPath, file.absolutePath));

    if (!fs.existsSync(destPath)) {
      const err = `Missing file after copy: ${destPath}`;
      onProgress({ phase: 'error', filesTotal: total, filesDone: i, errorMessage: err });
      throw new Error(err);
    }

    const destHash = hashFile(destPath);
    if (destHash !== file.hash) {
      const err = `Hash mismatch for ${file.relativePath}`;
      onProgress({ phase: 'error', filesTotal: total, filesDone: i, errorMessage: err });
      throw new Error(err);
    }

    onProgress({ phase: 'verifying', filesTotal: total, filesDone: i + 1 });
  }

  // Phase 3: Switch (caller is responsible for updating config after this resolves)
  onProgress({ phase: 'switching', filesTotal: total, filesDone: total });
  onProgress({ phase: 'done', filesTotal: total, filesDone: total });
}
