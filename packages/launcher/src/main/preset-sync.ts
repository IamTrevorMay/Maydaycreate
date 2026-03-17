import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import type { EffectPreset, PresetIndexEntry, PresetLibraryIndex, PresetFolder } from '@mayday/types';

export interface PresetSyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  machineId: string;
  machineName: string;
  presetDataDir: string;
}

interface SyncMeta {
  lastPulledAt: string | null;
}

const PRESETS_DIR = 'presets';
const INDEX_FILE = 'index.json';
const SYNC_META_FILE = '.sync-meta.json';

export class PresetSyncService {
  private client: SupabaseClient | null = null;
  private config: PresetSyncConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private pushQueue: Set<string> = new Set();
  private deleteQueue: Set<string> = new Set();
  private hasReconciled = false;

  initialize(config: PresetSyncConfig): void {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.log('[PresetSync] No Supabase credentials configured, sync disabled');
      return;
    }
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[PresetSync] Initialized for machine:', config.machineId);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  queuePush(presetId: string): void {
    if (presetId) {
      this.deleteQueue.delete(presetId);
      this.pushQueue.add(presetId);
    }
  }

  queueDelete(presetId: string): void {
    if (presetId) {
      this.pushQueue.delete(presetId);
      this.deleteQueue.add(presetId);
    }
  }

  async pushChanges(): Promise<number> {
    if (!this.client || !this.config) return 0;

    let pushed = 0;

    try {
      // Push new/updated presets
      if (this.pushQueue.size > 0) {
        const ids = [...this.pushQueue];
        this.pushQueue.clear();

        const rows = [];
        for (const id of ids) {
          const preset = this.loadPresetFromDisk(id);
          if (!preset) continue;
          rows.push(this.presetToRow(preset));
        }

        if (rows.length > 0) {
          const { error } = await this.client
            .from('presets')
            .upsert(rows, { onConflict: 'id' });

          if (error) {
            console.error('[PresetSync] Push upsert error:', error.message);
            // Re-queue failed items
            for (const id of ids) this.pushQueue.add(id);
          } else {
            pushed += rows.length;
          }
        }
      }

      // Push deletes (soft delete)
      if (this.deleteQueue.size > 0) {
        const ids = [...this.deleteQueue];
        this.deleteQueue.clear();

        for (const id of ids) {
          const { error } = await this.client
            .from('presets')
            .upsert({
              id,
              name: '',
              machine_id: this.config.machineId,
              machine_name: this.config.machineName,
              is_deleted: true,
              deleted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });

          if (error) {
            console.error('[PresetSync] Delete upsert error:', error.message);
            this.deleteQueue.add(id);
          } else {
            pushed++;
          }
        }
      }

      if (pushed > 0) {
        console.log(`[PresetSync] Pushed ${pushed} change(s)`);
      }
    } catch (err) {
      console.error('[PresetSync] Push error:', err);
    }

    return pushed;
  }

  async pullChanges(): Promise<number> {
    if (!this.client || !this.config) return 0;

    try {
      const meta = this.loadSyncMeta();
      let query = this.client
        .from('presets')
        .select('*')
        .order('updated_at', { ascending: true });

      if (meta.lastPulledAt) {
        query = query.gt('updated_at', meta.lastPulledAt);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[PresetSync] Pull error:', error.message);
        return 0;
      }

      if (!data || data.length === 0) return 0;

      let changed = 0;
      const baseDir = this.config.presetDataDir;
      this.ensureDirs(baseDir);

      for (const row of data) {
        if (row.is_deleted) {
          // Remove local file if it exists
          const presetPath = path.join(baseDir, PRESETS_DIR, `${row.id}.json`);
          if (fs.existsSync(presetPath)) {
            fs.unlinkSync(presetPath);
            changed++;
          }
        } else {
          // Write/update local file if remote is newer
          const localPreset = this.loadPresetFromDisk(row.id);
          const remoteUpdatedAt = new Date(row.updated_at).getTime();
          const localUpdatedAt = localPreset ? new Date(localPreset.updatedAt).getTime() : 0;

          if (remoteUpdatedAt > localUpdatedAt) {
            const preset = this.rowToPreset(row);
            const presetPath = path.join(baseDir, PRESETS_DIR, `${preset.id}.json`);
            fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2));
            changed++;
          }
        }
      }

      // Update watermark to the latest row's updated_at
      const lastRow = data[data.length - 1];
      meta.lastPulledAt = lastRow.updated_at;
      this.saveSyncMeta(meta);

      if (changed > 0) {
        this.rebuildIndex();
        console.log(`[PresetSync] Pulled ${changed} change(s)`);
      }

      return changed;
    } catch (err) {
      console.error('[PresetSync] Pull error:', err);
      return 0;
    }
  }

  async sync(): Promise<void> {
    await this.pushChanges();
    await this.pullChanges();
  }

  async fullReconciliation(): Promise<void> {
    if (!this.client || !this.config) return;

    try {
      console.log('[PresetSync] Starting full reconciliation...');

      // Pull everything first
      const meta = this.loadSyncMeta();
      meta.lastPulledAt = null;
      this.saveSyncMeta(meta);
      await this.pullChanges();

      // Now push any local presets that Supabase doesn't have or has older versions of
      const baseDir = this.config.presetDataDir;
      const index = this.loadIndexFromDisk();
      if (index.presets.length === 0) return;

      // Get all remote preset IDs and their updated_at
      const { data: remotePresets, error } = await this.client
        .from('presets')
        .select('id, updated_at, is_deleted');

      if (error) {
        console.error('[PresetSync] Reconciliation fetch error:', error.message);
        return;
      }

      const remoteMap = new Map<string, { updated_at: string; is_deleted: boolean }>();
      for (const r of (remotePresets || [])) {
        remoteMap.set(r.id, { updated_at: r.updated_at, is_deleted: r.is_deleted });
      }

      const toPush: EffectPreset[] = [];
      for (const entry of index.presets) {
        const preset = this.loadPresetFromDisk(entry.id);
        if (!preset) continue;

        const remote = remoteMap.get(entry.id);
        if (!remote || remote.is_deleted) {
          toPush.push(preset);
        } else {
          const localUpdated = new Date(preset.updatedAt).getTime();
          const remoteUpdated = new Date(remote.updated_at).getTime();
          if (localUpdated > remoteUpdated) {
            toPush.push(preset);
          }
        }
      }

      if (toPush.length > 0) {
        const rows = toPush.map(p => this.presetToRow(p));
        const { error: pushError } = await this.client
          .from('presets')
          .upsert(rows, { onConflict: 'id' });

        if (pushError) {
          console.error('[PresetSync] Reconciliation push error:', pushError.message);
        } else {
          console.log(`[PresetSync] Reconciliation pushed ${rows.length} preset(s)`);
        }
      }

      console.log('[PresetSync] Full reconciliation complete');
    } catch (err) {
      console.error('[PresetSync] Reconciliation error:', err);
    }
  }

  startPeriodicSync(): void {
    if (this.syncTimer) return;
    if (!this.client) return;

    // Initial full reconciliation after 12s
    setTimeout(async () => {
      if (!this.hasReconciled) {
        this.hasReconciled = true;
        await this.fullReconciliation();
      }
    }, 12000);

    // Periodic sync every 30s
    this.syncTimer = setInterval(() => {
      this.sync().catch(err => {
        console.error('[PresetSync] Periodic sync error:', err);
      });
    }, 30000);

    console.log('[PresetSync] Periodic sync started (30s interval)');
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  // --- Private helpers ---

  private presetToRow(preset: EffectPreset): Record<string, unknown> {
    return {
      id: preset.id,
      name: preset.name,
      version: preset.version,
      tags: preset.tags,
      folder: preset.folder,
      description: preset.description,
      source_clip_name: preset.sourceClipName,
      include_intrinsics: preset.includeIntrinsics,
      effects: preset.effects,
      machine_id: this.config!.machineId,
      machine_name: this.config!.machineName,
      is_deleted: false,
      deleted_at: null,
      created_at: preset.createdAt,
      updated_at: preset.updatedAt,
    };
  }

  private rowToPreset(row: Record<string, unknown>): EffectPreset {
    return {
      id: row.id as string,
      name: row.name as string,
      version: (row.version as number) || 1,
      tags: (row.tags as string[]) || [],
      folder: (row.folder as string) || '',
      description: (row.description as string) || '',
      sourceClipName: (row.source_clip_name as string) || '',
      includeIntrinsics: (row.include_intrinsics as boolean) || false,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      effects: (row.effects as EffectPreset['effects']) || [],
    };
  }

  private loadPresetFromDisk(presetId: string): EffectPreset | null {
    if (!this.config) return null;
    const presetPath = path.join(this.config.presetDataDir, PRESETS_DIR, `${presetId}.json`);
    if (!fs.existsSync(presetPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  private loadIndexFromDisk(): PresetLibraryIndex {
    if (!this.config) return { version: 1, presets: [], folders: [], lastUpdated: new Date().toISOString() };
    const indexPath = path.join(this.config.presetDataDir, INDEX_FILE);
    if (!fs.existsSync(indexPath)) return { version: 1, presets: [], folders: [], lastUpdated: new Date().toISOString() };
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    } catch {
      return { version: 1, presets: [], folders: [], lastUpdated: new Date().toISOString() };
    }
  }

  private rebuildIndex(): void {
    if (!this.config) return;
    const baseDir = this.config.presetDataDir;
    this.ensureDirs(baseDir);

    const presetsDir = path.join(baseDir, PRESETS_DIR);
    const files = fs.existsSync(presetsDir)
      ? fs.readdirSync(presetsDir).filter(f => f.endsWith('.json'))
      : [];

    const presets: PresetIndexEntry[] = [];
    for (const file of files) {
      try {
        const preset: EffectPreset = JSON.parse(
          fs.readFileSync(path.join(presetsDir, file), 'utf-8'),
        );
        presets.push({
          id: preset.id,
          name: preset.name,
          tags: preset.tags,
          folder: preset.folder,
          effectCount: preset.effects.filter(e => !e.isIntrinsic || preset.includeIntrinsics).length,
          sourceClipName: preset.sourceClipName,
          createdAt: preset.createdAt,
          updatedAt: preset.updatedAt,
        });
      } catch {
        // skip malformed files
      }
    }

    const folders = this.buildFolders(presets);
    const index: PresetLibraryIndex = {
      version: 1,
      presets,
      folders,
      lastUpdated: new Date().toISOString(),
    };

    fs.writeFileSync(path.join(baseDir, INDEX_FILE), JSON.stringify(index, null, 2));
  }

  private buildFolders(presets: PresetIndexEntry[]): PresetFolder[] {
    const folderMap = new Map<string, PresetFolder>();

    for (const p of presets) {
      const folderPath = p.folder || '';
      if (!folderPath) continue;

      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, {
          name: folderPath.split('/').pop() || folderPath,
          path: folderPath,
          children: [],
          presetCount: 0,
        });
      }
      folderMap.get(folderPath)!.presetCount++;
    }

    return Array.from(folderMap.values());
  }

  private ensureDirs(baseDir: string): void {
    const presetsDir = path.join(baseDir, PRESETS_DIR);
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }
  }

  private loadSyncMeta(): SyncMeta {
    if (!this.config) return { lastPulledAt: null };
    const metaPath = path.join(this.config.presetDataDir, SYNC_META_FILE);
    if (!fs.existsSync(metaPath)) return { lastPulledAt: null };
    try {
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {
      return { lastPulledAt: null };
    }
  }

  private saveSyncMeta(meta: SyncMeta): void {
    if (!this.config) return;
    this.ensureDirs(this.config.presetDataDir);
    const metaPath = path.join(this.config.presetDataDir, SYNC_META_FILE);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
}
