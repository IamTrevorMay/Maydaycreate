import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { PluginLifecycle } from '../plugins/lifecycle.js';

export interface SyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  machineId: string;
  machineName: string;
}

export interface AggregateCloudStats {
  totalEdits: number;
  totalSessions: number;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoRate: number;
  editsByType: Record<string, number>;
  machineCount: number;
}

export class SupabaseSyncService {
  private client: SupabaseClient | null = null;
  private config: SyncConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  initialize(config: SyncConfig): void {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.log('[SupabaseSync] No Supabase credentials configured, sync disabled');
      return;
    }
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[SupabaseSync] Initialized for machine:', config.machineId);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async pushNewData(lifecycle: PluginLifecycle): Promise<{ sessions: number; records: number }> {
    if (!this.client || !this.config) return { sessions: 0, records: 0 };

    try {
      // Get unsynced data from the plugin
      const syncData = await lifecycle.executeCommand('cutting-board', 'sync-data') as {
        sessions: Array<Record<string, unknown>>;
        records: Array<Record<string, unknown>>;
      } | null;

      if (!syncData) return { sessions: 0, records: 0 };

      let sessionsPushed = 0;
      let recordsPushed = 0;

      // Upsert sessions
      if (syncData.sessions.length > 0) {
        const sessionRows = syncData.sessions.map(s => ({
          local_id: s.id,
          machine_id: this.config!.machineId,
          machine_name: this.config!.machineName,
          sequence_id: s.sequence_id,
          sequence_name: s.sequence_name,
          started_at: s.started_at,
          ended_at: s.ended_at ?? null,
          total_edits: s.total_edits ?? 0,
        }));

        const { error } = await this.client
          .from('sessions')
          .upsert(sessionRows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[SupabaseSync] Session upsert error:', error.message);
        } else {
          sessionsPushed = sessionRows.length;
          const ids = syncData.sessions.map(s => s.id as number);
          await lifecycle.executeCommand('cutting-board', 'mark-synced', { table: 'sessions', ids });
        }
      }

      // Upsert cut records
      if (syncData.records.length > 0) {
        const recordRows = syncData.records.map(r => ({
          local_id: r.id,
          machine_id: this.config!.machineId,
          session_local_id: r.session_id,
          edit_type: r.edit_type,
          edit_point_time: r.edit_point_time,
          clip_name: r.clip_name,
          media_path: r.media_path,
          track_index: r.track_index,
          track_type: r.track_type,
          before_state: r.before_state ? JSON.parse(r.before_state as string) : null,
          after_state: r.after_state ? JSON.parse(r.after_state as string) : null,
          audio_category: r.audio_category ?? null,
          rating: r.rating ?? null,
          voice_transcript: r.voice_transcript ?? null,
          notes: r.notes ?? null,
          is_undo: r.is_undo === 1,
          detected_at: r.detected_at,
          feedback_at: r.feedback_at ?? null,
          boosted: r.boosted === 1,
        }));

        const { error } = await this.client
          .from('cut_records')
          .upsert(recordRows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[SupabaseSync] Record upsert error:', error.message);
        } else {
          recordsPushed = recordRows.length;
          const ids = syncData.records.map(r => r.id as number);
          await lifecycle.executeCommand('cutting-board', 'mark-synced', { table: 'cut_records', ids });
        }
      }

      if (sessionsPushed > 0 || recordsPushed > 0) {
        console.log(`[SupabaseSync] Pushed ${sessionsPushed} sessions, ${recordsPushed} records`);
      }

      return { sessions: sessionsPushed, records: recordsPushed };
    } catch (err) {
      console.error('[SupabaseSync] Push error:', err);
      return { sessions: 0, records: 0 };
    }
  }

  async getAggregateStats(): Promise<AggregateCloudStats | null> {
    if (!this.client) return null;

    try {
      // Total edits (non-undo)
      const { count: totalEdits } = await this.client
        .from('cut_records')
        .select('*', { count: 'exact', head: true });

      // Total sessions
      const { count: totalSessions } = await this.client
        .from('sessions')
        .select('*', { count: 'exact', head: true });

      // Thumbs up/down
      const { count: thumbsUp } = await this.client
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('rating', 1);

      const { count: thumbsDown } = await this.client
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('rating', 0);

      // Boosted
      const { count: boostedCount } = await this.client
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('boosted', true);

      // Undo count
      const { count: undoCount } = await this.client
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('is_undo', true);

      // Edit type breakdown via RPC
      const { data: editTypes } = await this.client.rpc('get_edit_type_counts');

      // Distinct machines
      const { data: machines } = await this.client
        .from('sessions')
        .select('machine_id');
      const machineCount = new Set(machines?.map(m => m.machine_id) ?? []).size;

      const rated = (thumbsUp ?? 0) + (thumbsDown ?? 0);
      const approvalRate = rated > 0 ? (thumbsUp ?? 0) / rated : null;
      const total = totalEdits ?? 0;
      const undoRate = total > 0 ? (undoCount ?? 0) / total : 0;

      const editsByType: Record<string, number> = {};
      if (editTypes) {
        for (const row of editTypes) {
          editsByType[row.edit_type] = Number(row.count);
        }
      }

      return {
        totalEdits: total,
        totalSessions: totalSessions ?? 0,
        approvalRate,
        thumbsUp: thumbsUp ?? 0,
        thumbsDown: thumbsDown ?? 0,
        boostedCount: boostedCount ?? 0,
        undoRate,
        editsByType,
        machineCount,
      };
    } catch (err) {
      console.error('[SupabaseSync] getAggregateStats error:', err);
      return null;
    }
  }

  startPeriodicSync(lifecycle: PluginLifecycle, intervalMs = 30000): void {
    if (this.syncTimer) return;
    if (!this.client) return;

    // Initial sync after short delay
    setTimeout(() => this.pushNewData(lifecycle), 5000);

    this.syncTimer = setInterval(() => {
      this.pushNewData(lifecycle).catch(err => {
        console.error('[SupabaseSync] Periodic sync error:', err);
      });
    }, intervalMs);

    console.log(`[SupabaseSync] Periodic sync started (${intervalMs / 1000}s interval)`);
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}
