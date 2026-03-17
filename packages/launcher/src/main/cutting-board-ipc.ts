import { ipcMain, app } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
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

function getAggregateStats(): CuttingBoardAggregateStats | null {
  const db = openDb();
  if (!db) return null;

  try {
    const totalEdits = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0').get() as { c: number }).c;
    const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;

    const rated = db.prepare('SELECT rating FROM cut_records WHERE rating IS NOT NULL AND is_undo = 0').all() as { rating: number }[];
    const thumbsUp = rated.filter(r => r.rating >= 4).length;
    const thumbsDown = rated.filter(r => r.rating <= 2).length;
    const approvalRate = rated.length > 0 ? thumbsUp / rated.length : null;

    const boostedCount = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE boosted = 1').get() as { c: number }).c;

    const totalWithUndo = (db.prepare('SELECT COUNT(*) as c FROM cut_records').get() as { c: number }).c;
    const undos = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 1').get() as { c: number }).c;
    const undoRate = totalWithUndo > 0 ? undos / totalWithUndo : 0;

    const typeRows = db.prepare('SELECT edit_type, COUNT(*) as c FROM cut_records WHERE is_undo = 0 GROUP BY edit_type').all() as { edit_type: string; c: number }[];
    const editsByType: Record<string, number> = {};
    for (const r of typeRows) editsByType[r.edit_type] = r.c;

    const recentRows = db.prepare(`
      SELECT s.id, s.sequence_name, s.started_at, s.total_edits,
        (SELECT CAST(SUM(CASE WHEN cr.rating >= 4 THEN 1 ELSE 0 END) AS REAL) / NULLIF(COUNT(cr.rating), 0)
         FROM cut_records cr WHERE cr.session_id = s.id AND cr.rating IS NOT NULL AND cr.is_undo = 0) as approval_rate
      FROM sessions s ORDER BY s.started_at DESC LIMIT 5
    `).all() as { id: number; sequence_name: string; started_at: number; total_edits: number; approval_rate: number | null }[];

    const recentSessions = recentRows.map(r => ({
      id: r.id,
      sequenceName: r.sequence_name,
      startedAt: r.started_at,
      totalEdits: r.total_edits,
      approvalRate: r.approval_rate,
    }));

    return { totalEdits, totalSessions, approvalRate, thumbsUp, thumbsDown, boostedCount, undoRate, editsByType, recentSessions };
  } finally {
    db.close();
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
