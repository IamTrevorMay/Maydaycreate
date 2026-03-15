import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { OfflineQueueEntry } from './types.js';

function getQueuePath(syncSourcePath: string): string {
  return path.join(syncSourcePath, 'queue', 'pending.json');
}

export function readQueue(syncSourcePath: string): OfflineQueueEntry[] {
  const queuePath = getQueuePath(syncSourcePath);
  if (!fs.existsSync(queuePath)) return [];

  try {
    return JSON.parse(fs.readFileSync(queuePath, 'utf-8')) as OfflineQueueEntry[];
  } catch {
    return [];
  }
}

function writeQueue(syncSourcePath: string, entries: OfflineQueueEntry[]): void {
  const queuePath = getQueuePath(syncSourcePath);
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Stage a local file change to the offline queue.
 */
export function enqueue(
  syncSourcePath: string,
  relativePath: string,
  localPath: string,
  localHash: string,
): void {
  const entries = readQueue(syncSourcePath);

  // Replace existing entry for same path (de-duplicate)
  const filtered = entries.filter(e => e.relativePath !== relativePath);
  filtered.push({
    id: uuid(),
    timestamp: new Date().toISOString(),
    operation: 'push',
    relativePath,
    localPath,
    localHash,
  });

  writeQueue(syncSourcePath, filtered);
}

/**
 * Remove all entries from the queue (after successful flush).
 */
export function clearQueue(syncSourcePath: string): void {
  writeQueue(syncSourcePath, []);
}

/**
 * Remove a single entry by id.
 */
export function dequeue(syncSourcePath: string, id: string): void {
  const entries = readQueue(syncSourcePath);
  writeQueue(syncSourcePath, entries.filter(e => e.id !== id));
}
