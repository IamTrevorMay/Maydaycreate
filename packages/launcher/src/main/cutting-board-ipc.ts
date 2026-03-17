import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config-store.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun } from '@mayday/types';

function getDbPath(): string {
  return path.join(app.getPath('userData'), 'plugin-data', 'cutting-board', 'cutting-board.db');
}

function openDb(): Database.Database | null {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

async function getAggregateStats(): Promise<CuttingBoardAggregateStats | null> {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  try {
    // Total edits
    const { count: totalEdits } = await supabase
      .from('cut_records')
      .select('*', { count: 'exact', head: true });

    // Total sessions
    const { count: totalSessions } = await supabase
      .from('sessions')
      .select('*', { count: 'exact', head: true });

    // Thumbs up (rating = 1)
    const { count: thumbsUp } = await supabase
      .from('cut_records')
      .select('*', { count: 'exact', head: true })
      .eq('rating', 1);

    // Thumbs down (rating = 0)
    const { count: thumbsDown } = await supabase
      .from('cut_records')
      .select('*', { count: 'exact', head: true })
      .eq('rating', 0);

    // Boosted
    const { count: boostedCount } = await supabase
      .from('cut_records')
      .select('*', { count: 'exact', head: true })
      .eq('boosted', true);

    // Undo count
    const { count: undoCount } = await supabase
      .from('cut_records')
      .select('*', { count: 'exact', head: true })
      .eq('is_undo', true);

    // Edit type breakdown via RPC
    const { data: editTypes } = await supabase.rpc('get_edit_type_counts');

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

    // Recent sessions with approval rates
    const { data: sessionRows } = await supabase
      .from('sessions')
      .select('id, sequence_name, started_at, total_edits')
      .order('started_at', { ascending: false })
      .limit(5);

    const recentSessions: CuttingBoardAggregateStats['recentSessions'] = [];
    if (sessionRows) {
      for (const s of sessionRows) {
        // Compute approval rate for each session
        const { count: sessionUp } = await supabase
          .from('cut_records')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', s.id)
          .eq('rating', 1);

        const { count: sessionDown } = await supabase
          .from('cut_records')
          .select('*', { count: 'exact', head: true })
          .eq('session_id', s.id)
          .eq('rating', 0);

        const sessionRated = (sessionUp ?? 0) + (sessionDown ?? 0);
        const sessionApproval = sessionRated > 0 ? (sessionUp ?? 0) / sessionRated : null;

        recentSessions.push({
          id: s.id,
          sequenceName: s.sequence_name,
          startedAt: s.started_at,
          totalEdits: s.total_edits,
          approvalRate: sessionApproval,
        });
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
      recentSessions,
    };
  } catch (err) {
    console.error('[CuttingBoard] Supabase getAggregateStats error:', err);
    return null;
  }
}

function getTrainingRuns(): CuttingBoardTrainingRun[] {
  const db = openDb();
  if (!db) return [];

  try {
    const rows = db.prepare('SELECT id, trained_at, training_size, accuracy, version FROM model_training_runs ORDER BY trained_at DESC').all() as {
      id: number; trained_at: number; training_size: number; accuracy: number; version: number;
    }[];
    return rows.map(r => ({
      id: r.id,
      trainedAt: r.trained_at,
      trainingSize: r.training_size,
      accuracy: r.accuracy,
      version: r.version,
    }));
  } finally {
    db.close();
  }
}

export function registerCuttingBoardHandlers(): void {
  ipcMain.handle('cuttingBoard:getAggregateStats', () => {
    return getAggregateStats();
  });

  ipcMain.handle('cuttingBoard:getTrainingRuns', () => {
    return getTrainingRuns();
  });

  ipcMain.handle('cuttingBoard:trainModel', async () => {
    const config = loadConfig();
    const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/train-model`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Train model failed: ${res.status}`);
    return res.json();
  });
}
