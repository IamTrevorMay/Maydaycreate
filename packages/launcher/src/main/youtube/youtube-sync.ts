import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { YouTubeDB } from './youtube-db.js';

export interface YouTubeSyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  machineId: string;
  machineName: string;
}

export class YouTubeSyncService {
  private client: SupabaseClient | null = null;
  private config: YouTubeSyncConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  initialize(config: YouTubeSyncConfig): void {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.log('[YouTubeSync] No Supabase credentials configured, sync disabled');
      return;
    }
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[YouTubeSync] Initialized for machine:', config.machineId);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async pushNewData(db: YouTubeDB): Promise<{ analyses: number; effects: number; corrections: number }> {
    if (!this.client || !this.config) return { analyses: 0, effects: 0, corrections: 0 };

    try {
      let analysesPushed = 0;
      let effectsPushed = 0;
      let correctionsPushed = 0;

      // Upsert analyses
      const unsyncedAnalyses = db.getUnsyncedAnalyses();
      if (unsyncedAnalyses.length > 0) {
        const rows = unsyncedAnalyses.map(a => ({
          local_id: a.id as string,
          machine_id: this.config!.machineId,
          video_id: a.video_id as string,
          url: a.url as string,
          title: a.title as string,
          channel: a.channel as string,
          duration: a.duration as number,
          thumbnail_url: (a.thumbnail_url as string) || null,
          upload_date: (a.upload_date as string) || null,
          description: (a.description as string) || null,
          resolution: (a.resolution as string) || null,
          fps: (a.fps as number) || null,
          status: a.status as string,
          frame_count: (a.frame_count as number) || 0,
          effect_count: (a.effect_count as number) || 0,
          summary: (a.summary as string) || '',
          style_notes: (a.style_notes as string) || '',
          analysis_time_ms: (a.analysis_time_ms as number) || null,
          created_at: a.created_at as string,
          completed_at: (a.completed_at as string) || null,
        }));

        const { error } = await this.client
          .from('yt_analyses')
          .upsert(rows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[YouTubeSync] Analysis upsert error:', error.message);
        } else {
          analysesPushed = rows.length;
          db.markSynced('analyses', unsyncedAnalyses.map(a => a.id as string));
        }
      }

      // Upsert effects
      const unsyncedEffects = db.getUnsyncedEffects();
      if (unsyncedEffects.length > 0) {
        const rows = unsyncedEffects.map(e => ({
          local_id: e.id as string,
          machine_id: this.config!.machineId,
          analysis_local_id: e.analysis_id as string,
          effect_index: e.effect_index as number,
          start_time: e.start_time as number,
          end_time: e.end_time as number,
          category: e.category as string,
          secondary_categories: safeJsonParse(e.secondary_categories as string, []),
          description: e.description as string,
          confidence: (e.confidence as string) || 'medium',
          premiere_recreation: safeJsonParse(e.premiere_recreation as string, {}),
          rating: (e.rating as number) ?? null,
          correction_note: (e.correction_note as string) || null,
          source_identification: (e.source_identification as string) || null,
          source: (e.source as string) || 'ai',
        }));

        const { error } = await this.client
          .from('yt_effects')
          .upsert(rows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[YouTubeSync] Effect upsert error:', error.message);
        } else {
          effectsPushed = rows.length;
          db.markSynced('effects', unsyncedEffects.map(e => e.id as string));
        }
      }

      // Upsert corrections
      const unsyncedCorrections = db.getUnsyncedCorrections();
      if (unsyncedCorrections.length > 0) {
        const rows = unsyncedCorrections.map(c => ({
          local_id: c.id as string,
          machine_id: this.config!.machineId,
          effect_local_id: c.effect_id as string,
          analysis_local_id: c.analysis_id as string,
          original_category: c.original_category as string,
          corrected_category: (c.corrected_category as string) || null,
          original_description: c.original_description as string,
          correction_note: c.correction_note as string,
          created_at: c.created_at as string,
        }));

        const { error } = await this.client
          .from('yt_corrections')
          .upsert(rows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[YouTubeSync] Correction upsert error:', error.message);
        } else {
          correctionsPushed = rows.length;
          db.markSynced('corrections', unsyncedCorrections.map(c => c.id as string));
        }
      }

      if (analysesPushed > 0 || effectsPushed > 0 || correctionsPushed > 0) {
        console.log(`[YouTubeSync] Pushed ${analysesPushed} analyses, ${effectsPushed} effects, ${correctionsPushed} corrections`);
      }

      return { analyses: analysesPushed, effects: effectsPushed, corrections: correctionsPushed };
    } catch (err) {
      console.error('[YouTubeSync] Push error:', err);
      return { analyses: 0, effects: 0, corrections: 0 };
    }
  }

  startPeriodicSync(db: YouTubeDB, intervalMs = 30000): void {
    if (this.syncTimer) return;
    if (!this.client) return;

    // Initial sync after 8s delay
    setTimeout(() => this.pushNewData(db), 8000);

    this.syncTimer = setInterval(() => {
      this.pushNewData(db).catch(err => {
        console.error('[YouTubeSync] Periodic sync error:', err);
      });
    }, intervalMs);

    console.log(`[YouTubeSync] Periodic sync started (${intervalMs / 1000}s interval)`);
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

function safeJsonParse(str: string | null | undefined, fallback: unknown): unknown {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
