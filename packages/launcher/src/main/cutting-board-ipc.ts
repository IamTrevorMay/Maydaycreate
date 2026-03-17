import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config-store.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun } from '@mayday/types';

function getDbPath(): string {
  // In dev mode, userData is "Electron"; in packaged mode it's "@mayday/launcher"
  // Check both locations so dev mode can read data from the packaged app's DB
  const primary = path.join(app.getPath('userData'), 'plugin-data', 'cutting-board', 'cutting-board.db');
  if (fs.existsSync(primary)) return primary;

  const packaged = path.join(app.getPath('home'), 'Library', 'Application Support', '@mayday', 'launcher', 'plugin-data', 'cutting-board', 'cutting-board.db');
  if (fs.existsSync(packaged)) {
    console.log('[CuttingBoard] Using packaged DB path:', packaged);
    return packaged;
  }

  console.log('[CuttingBoard] No DB found. Primary:', primary, 'Packaged:', packaged);
  return primary;
}

function openDb(): Database.Database | null {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

function getAggregateStatsLocal(): CuttingBoardAggregateStats | null {
  const db = openDb();
  if (!db) return null;

  try {
    const totalEdits = (db.prepare('SELECT COUNT(*) as c FROM cut_records').get() as { c: number }).c;
    const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
    const thumbsUp = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE rating = 1').get() as { c: number }).c;
    const thumbsDown = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE rating = 0').get() as { c: number }).c;
    const boostedCount = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE boosted = 1').get() as { c: number }).c;
    const undoCount = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 1').get() as { c: number }).c;

    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;
    const undoRate = totalEdits > 0 ? undoCount / totalEdits : 0;

    const editTypeRows = db.prepare('SELECT edit_type, COUNT(*) as count FROM cut_records GROUP BY edit_type').all() as { edit_type: string; count: number }[];
    const editsByType: Record<string, number> = {};
    for (const row of editTypeRows) {
      editsByType[row.edit_type] = row.count;
    }

    const sessionRows = db.prepare('SELECT id, sequence_name, started_at, total_edits FROM sessions ORDER BY started_at DESC LIMIT 5').all() as {
      id: string; sequence_name: string; started_at: string; total_edits: number;
    }[];

    const recentSessions: CuttingBoardAggregateStats['recentSessions'] = [];
    for (const s of sessionRows) {
      const sUp = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE session_id = ? AND rating = 1').get(s.id) as { c: number }).c;
      const sDown = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE session_id = ? AND rating = 0').get(s.id) as { c: number }).c;
      const sRated = sUp + sDown;
      recentSessions.push({
        id: s.id,
        sequenceName: s.sequence_name,
        startedAt: s.started_at,
        totalEdits: s.total_edits,
        approvalRate: sRated > 0 ? sUp / sRated : null,
      });
    }

    return {
      totalEdits,
      totalSessions,
      approvalRate,
      thumbsUp,
      thumbsDown,
      boostedCount,
      undoRate,
      editsByType,
      recentSessions,
    };
  } catch (err) {
    console.error('[CuttingBoard] Local getAggregateStats error:', err);
    return null;
  } finally {
    db.close();
  }
}

async function getAggregateStatsSupabase(): Promise<CuttingBoardAggregateStats | null> {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const { count: totalEdits } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true });

  const { count: totalSessions } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true });

  const { count: thumbsUp } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('rating', 1);

  const { count: thumbsDown } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('rating', 0);

  const { count: boostedCount } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('boosted', true);

  const { count: undoCount } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('is_undo', true);

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

  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('id, sequence_name, started_at, total_edits')
    .order('started_at', { ascending: false })
    .limit(5);

  const recentSessions: CuttingBoardAggregateStats['recentSessions'] = [];
  if (sessionRows) {
    for (const s of sessionRows) {
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
}

async function getAggregateStats(): Promise<CuttingBoardAggregateStats | null> {
  // Try Supabase first, fall back to local SQLite
  try {
    const result = await getAggregateStatsSupabase();
    if (result) return result;
  } catch (err) {
    console.error('[CuttingBoard] Supabase getAggregateStats error:', err);
  }

  return getAggregateStatsLocal();
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
  ipcMain.handle('cuttingBoard:getAggregateStats', async () => {
    try {
      const result = await getAggregateStats();
      console.log('[CuttingBoard] getAggregateStats result:', result ? `${result.totalEdits} edits` : 'null');
      return result;
    } catch (err) {
      console.error('[CuttingBoard] getAggregateStats handler error:', err);
      return null;
    }
  });

  ipcMain.handle('cuttingBoard:getTrainingRuns', async () => {
    // Try local SQLite first (works in packaged app)
    try {
      const result = getTrainingRuns();
      if (result.length > 0) return result;
    } catch {
      // better-sqlite3 native module fails in dev mode — fall through to server API
    }

    // Fall back to server plugin API
    try {
      const config = loadConfig();
      const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/autocut-status`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.result?.model) {
          const m = data.result.model;
          return [{
            id: m.version,
            trainedAt: m.trainedAt,
            trainingSize: m.trainingSize,
            accuracy: m.accuracy,
            version: m.version,
          }];
        }
      }
    } catch (err) {
      console.error('[CuttingBoard] getTrainingRuns fallback error:', err);
    }

    return [];
  });

  ipcMain.handle('cuttingBoard:trainModel', async () => {
    const config = loadConfig();
    const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/train-model`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`Train model failed: ${res.status}`);
    const data = await res.json();
    // Return the training result directly so the UI can use it
    return data.success ? data.result : data;
  });
}
