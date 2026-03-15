import chokidar from 'chokidar';
import type { SyncEngine } from './engine.js';

export interface WatcherOptions {
  syncSourcePath: string;
  engine: SyncEngine;
  /** Debounce delay in ms before triggering sync. Default 2000. */
  debounceMs?: number;
}

/**
 * Watch the sync source folder for external changes (e.g. Dropbox syncing files)
 * and trigger a sync run automatically.
 */
export class SyncWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private engine: SyncEngine;
  private syncSourcePath: string;

  constructor(opts: WatcherOptions) {
    this.syncSourcePath = opts.syncSourcePath;
    this.engine = opts.engine;
    this.debounceMs = opts.debounceMs ?? 2000;
  }

  start(): void {
    if (this.watcher) return;

    this.watcher = chokidar.watch(this.syncSourcePath, {
      ignoreInitial: true,
      ignored: [
        /history\//,        // Don't react to history changes
        /queue\//,          // Don't react to queue changes
        /manifest\.json$/,  // Don't react to manifest updates we wrote
      ],
      awaitWriteFinish: { stabilityThreshold: 500 },
    });

    this.watcher.on('all', () => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.engine.runSync().catch(err => {
          console.error('[SyncWatcher] Auto-sync failed:', err);
        });
      }, this.debounceMs);
    });

    console.log('[SyncWatcher] Watching:', this.syncSourcePath);
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    await this.watcher?.close();
    this.watcher = null;
  }
}
