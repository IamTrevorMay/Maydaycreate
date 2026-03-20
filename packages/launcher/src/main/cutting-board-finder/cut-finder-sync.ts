import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CutFinderDB } from './cut-finder-db.js';

export interface CutFinderSyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  machineId: string;
}

export class CutFinderSyncService {
  private client: SupabaseClient | null = null;
  private config: CutFinderSyncConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;

  initialize(config: CutFinderSyncConfig): void {
    if (!config.supabaseUrl || !config.supabaseAnonKey) return;
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async pushCuts(db: CutFinderDB): Promise<number> {
    if (!this.client || !this.config) return 0;

    try {
      const analyses = db.listAnalyses().filter(a => a.status === 'complete');
      let totalPushed = 0;

      for (const analysis of analyses) {
        const cuts = db.getCuts(analysis.id);
        if (cuts.length === 0) continue;

        const rows = cuts.map(c => ({
          local_id: c.id,
          machine_id: this.config!.machineId,
          analysis_local_id: c.analysisId,
          video_id: c.videoId ?? null,
          cut_index: c.cutIndex,
          timestamp: c.timestamp,
          confidence: c.confidence,
          diff_score: c.diffScore,
          intent_tags: c.intentTags ?? [],
        }));

        const { error } = await this.client
          .from('cf_cuts')
          .upsert(rows, { onConflict: 'machine_id,local_id' });

        if (error) {
          console.error('[CutFinderSync] Upsert error:', error.message);
        } else {
          totalPushed += rows.length;
        }
      }

      if (totalPushed > 0) {
        console.log(`[CutFinderSync] Pushed ${totalPushed} cuts`);
      }
      return totalPushed;
    } catch (err) {
      console.error('[CutFinderSync] Push error:', err);
      return 0;
    }
  }

  startPeriodicSync(db: CutFinderDB, intervalMs = 30000): void {
    if (this.syncTimer || !this.client) return;
    setTimeout(() => this.pushCuts(db), 8000);
    this.syncTimer = setInterval(() => {
      this.pushCuts(db).catch(err => console.error('[CutFinderSync] Periodic error:', err));
    }, intervalMs);
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}
