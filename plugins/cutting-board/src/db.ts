import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { CutRecord, Session } from './types.js';

export class CuttingBoardDB {
  private db: Database.Database;

  constructor(dataDir: string) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, 'cutting-board.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL,
        sequence_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        total_edits INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS model_training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trained_at INTEGER NOT NULL,
        training_size INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        version INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cut_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        edit_type TEXT NOT NULL,
        edit_point_time REAL NOT NULL,
        clip_name TEXT NOT NULL,
        media_path TEXT NOT NULL,
        track_index INTEGER NOT NULL,
        track_type TEXT NOT NULL,
        before_state TEXT,
        after_state TEXT,
        audio_category TEXT,
        rating INTEGER,
        voice_transcript TEXT,
        notes TEXT,
        is_undo INTEGER NOT NULL DEFAULT 0,
        detected_at INTEGER NOT NULL,
        feedback_at INTEGER,
        boosted INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Migration: add boosted column if missing (existing DBs)
    const cols = this.db.prepare("PRAGMA table_info(cut_records)").all() as { name: string }[];
    if (!cols.some(c => c.name === 'boosted')) {
      this.db.exec(`
        ALTER TABLE cut_records ADD COLUMN boosted INTEGER NOT NULL DEFAULT 0;
        UPDATE cut_records SET rating = 0 WHERE rating IS NOT NULL AND rating <= 2;
        UPDATE cut_records SET rating = 1 WHERE rating IS NOT NULL AND rating >= 3;
      `);
    }

    // Migration: add intent_tags column (JSON array of tag IDs)
    if (!cols.some(c => c.name === 'intent_tags')) {
      this.db.exec(`ALTER TABLE cut_records ADD COLUMN intent_tags TEXT DEFAULT '[]';`);
    }

    // Migration: add synced_at columns for cloud sync
    if (!cols.some(c => c.name === 'synced_at')) {
      this.db.exec(`ALTER TABLE cut_records ADD COLUMN synced_at INTEGER;`);
    }
    const sessionCols = this.db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
    if (!sessionCols.some(c => c.name === 'synced_at')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN synced_at INTEGER;`);
    }

    // Migration: add video_id column to sessions
    if (!sessionCols.some(c => c.name === 'video_id')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN video_id TEXT;`);
    }
  }

  createSession(sequenceId: string, sequenceName: string, videoId?: string): number {
    const stmt = this.db.prepare(
      'INSERT INTO sessions (sequence_id, sequence_name, started_at, video_id) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(sequenceId, sequenceName, Date.now(), videoId ?? null);
    return result.lastInsertRowid as number;
  }

  endSession(sessionId: number, totalEdits: number): void {
    this.db.prepare(
      'UPDATE sessions SET ended_at = ?, total_edits = ? WHERE id = ?'
    ).run(Date.now(), totalEdits, sessionId);
  }

  insertRecord(record: Omit<CutRecord, 'id'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO cut_records (
        session_id, edit_type, edit_point_time, clip_name, media_path,
        track_index, track_type, before_state, after_state,
        audio_category, rating, voice_transcript, notes,
        is_undo, detected_at, feedback_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.sessionId,
      record.editType,
      record.editPointTime,
      record.clipName,
      record.mediaPath,
      record.trackIndex,
      record.trackType,
      record.beforeState,
      record.afterState,
      record.audioCategory,
      record.rating,
      record.voiceTranscript,
      record.notes,
      record.isUndo ? 1 : 0,
      record.detectedAt,
      record.feedbackAt,
    );
    return result.lastInsertRowid as number;
  }

  updateRating(recordId: number, rating: number, notes?: string): void {
    this.db.prepare(
      'UPDATE cut_records SET rating = ?, notes = ?, feedback_at = ? WHERE id = ?'
    ).run(rating, notes || null, Date.now(), recordId);
  }

  boostRecord(recordId: number): void {
    this.db.prepare(
      'UPDATE cut_records SET boosted = 1 WHERE id = ?'
    ).run(recordId);
  }

  setIntentTags(recordId: number, tags: string[]): void {
    this.db.prepare(
      'UPDATE cut_records SET intent_tags = ? WHERE id = ?'
    ).run(JSON.stringify(tags), recordId);
    // Any tags imply the user valued this cut — also set boosted for training weight
    if (tags.length > 0) {
      this.db.prepare(
        'UPDATE cut_records SET boosted = 1 WHERE id = ?'
      ).run(recordId);
    }
  }

  getIntentTags(recordId: number): string[] {
    const row = this.db.prepare('SELECT intent_tags FROM cut_records WHERE id = ?').get(recordId) as { intent_tags: string } | undefined;
    if (!row?.intent_tags) return [];
    try { return JSON.parse(row.intent_tags); } catch { return []; }
  }

  markPreviousEditAsDown(sessionId: number, currentRecordId: number): void {
    this.db.prepare(
      'UPDATE cut_records SET rating = 0 WHERE session_id = ? AND id < ? AND is_undo = 0 ORDER BY id DESC LIMIT 1'
    ).run(sessionId, currentRecordId);
  }

  getSessionStats(sessionId: number): {
    totalEdits: number;
    editsByType: Record<string, number>;
    approvalRate: number | null;
    thumbsUp: number;
    thumbsDown: number;
    boostedCount: number;
    undoCount: number;
  } {
    const total = this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE session_id = ?'
    ).get(sessionId) as { count: number };

    const byType = this.db.prepare(
      'SELECT edit_type, COUNT(*) as count FROM cut_records WHERE session_id = ? GROUP BY edit_type'
    ).all(sessionId) as { edit_type: string; count: number }[];

    const thumbsUp = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND rating = 1'
    ).get(sessionId) as { count: number }).count;

    const thumbsDown = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND rating = 0'
    ).get(sessionId) as { count: number }).count;

    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;

    const boostedCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND boosted = 1'
    ).get(sessionId) as { count: number }).count;

    const undos = this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND is_undo = 1'
    ).get(sessionId) as { count: number };

    const editsByType: Record<string, number> = {};
    for (const row of byType) {
      editsByType[row.edit_type] = row.count;
    }

    return {
      totalEdits: total.count,
      editsByType,
      approvalRate,
      thumbsUp,
      thumbsDown,
      boostedCount,
      undoCount: undos.count,
    };
  }

  getAggregateStats(): {
    totalEdits: number;
    totalSessions: number;
    approvalRate: number | null;
    thumbsUp: number;
    thumbsDown: number;
    boostedCount: number;
    undoRate: number;
    editsByType: Record<string, number>;
    tagCounts: Record<string, number>;
    recentSessions: Array<{
      id: number;
      sequenceName: string;
      startedAt: number;
      totalEdits: number;
      approvalRate: number | null;
    }>;
  } {
    const totalEdits = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records'
    ).get() as { count: number }).count;

    const totalSessions = (this.db.prepare(
      'SELECT COUNT(*) as count FROM sessions'
    ).get() as { count: number }).count;

    const thumbsUp = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE rating = 1'
    ).get() as { count: number }).count;

    const thumbsDown = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE rating = 0'
    ).get() as { count: number }).count;

    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;

    const boostedCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE boosted = 1'
    ).get() as { count: number }).count;

    const undoCount = (this.db.prepare(
      'SELECT COUNT(*) as count FROM cut_records WHERE is_undo = 1'
    ).get() as { count: number }).count;

    const undoRate = totalEdits > 0 ? undoCount / totalEdits : 0;

    const byType = this.db.prepare(
      'SELECT edit_type, COUNT(*) as count FROM cut_records GROUP BY edit_type'
    ).all() as { edit_type: string; count: number }[];

    const editsByType: Record<string, number> = {};
    for (const row of byType) {
      editsByType[row.edit_type] = row.count;
    }

    const recentSessions = this.db.prepare(`
      SELECT s.id, s.sequence_name, s.started_at, s.total_edits,
        (SELECT CASE WHEN COUNT(r.rating) > 0 THEN
          CAST(SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(r.rating)
        ELSE NULL END FROM cut_records r WHERE r.session_id = s.id AND r.rating IS NOT NULL) as approval_rate
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT 5
    `).all() as Array<{
      id: number;
      sequence_name: string;
      started_at: number;
      total_edits: number;
      approval_rate: number | null;
    }>;

    // Aggregate intent tag counts across all records
    const tagRows = this.db.prepare(
      "SELECT intent_tags FROM cut_records WHERE intent_tags IS NOT NULL AND intent_tags != '[]'"
    ).all() as { intent_tags: string }[];
    const tagCounts: Record<string, number> = {};
    for (const row of tagRows) {
      try {
        const tags: string[] = JSON.parse(row.intent_tags);
        for (const t of tags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      } catch { /* skip malformed */ }
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
      tagCounts,
      recentSessions: recentSessions.map(s => ({
        id: s.id,
        sequenceName: s.sequence_name,
        startedAt: s.started_at,
        totalEdits: s.total_edits,
        approvalRate: s.approval_rate,
      })),
    };
  }

  getRecentRecords(limit = 20): unknown[] {
    return this.db.prepare(`
      SELECT cr.*, s.sequence_name
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      ORDER BY cr.detected_at DESC
      LIMIT ?
    `).all(limit);
  }

  exportAllRecords(): { sessions: unknown[]; records: unknown[] } {
    const sessions = this.db.prepare('SELECT * FROM sessions').all();
    const records = this.db.prepare('SELECT * FROM cut_records').all();
    return { sessions, records };
  }

  getAllForTraining(): CutRecord[] {
    return this.db.prepare(`
      SELECT
        cr.id, cr.session_id AS sessionId, cr.edit_type AS editType,
        cr.edit_point_time AS editPointTime, cr.clip_name AS clipName,
        cr.media_path AS mediaPath, cr.track_index AS trackIndex,
        cr.track_type AS trackType, cr.before_state AS beforeState,
        cr.after_state AS afterState, cr.audio_category AS audioCategory,
        cr.rating, cr.voice_transcript AS voiceTranscript, cr.notes,
        cr.is_undo AS isUndo, cr.detected_at AS detectedAt,
        cr.feedback_at AS feedbackAt, cr.boosted,
        s.sequence_name AS sequenceName
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      WHERE cr.is_undo = 0
      ORDER BY cr.detected_at ASC
    `).all() as CutRecord[];
  }

  getQualityRecords(): Array<CutRecord & { quality: string; weight: number }> {
    const records = this.db.prepare(`
      SELECT
        cr.id, cr.session_id AS sessionId, cr.edit_type AS editType,
        cr.edit_point_time AS editPointTime, cr.clip_name AS clipName,
        cr.media_path AS mediaPath, cr.track_index AS trackIndex,
        cr.track_type AS trackType, cr.before_state AS beforeState,
        cr.after_state AS afterState, cr.audio_category AS audioCategory,
        cr.rating, cr.voice_transcript AS voiceTranscript, cr.notes,
        cr.is_undo AS isUndo, cr.detected_at AS detectedAt,
        cr.feedback_at AS feedbackAt, cr.boosted,
        s.sequence_name AS sequenceName
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      WHERE cr.is_undo = 0
      ORDER BY cr.detected_at ASC
    `).all() as (CutRecord & { boosted: number })[];

    return records.map(r => {
      let quality: string;
      let weight: number;
      if (r.boosted === 1) {
        quality = 'boosted';
        weight = 3.0;
      } else if (r.rating === 1) {
        quality = 'good';
        weight = 1.0;
      } else if (r.rating === 0) {
        quality = 'bad';
        weight = 0;
      } else {
        quality = 'good'; // unrated defaults to good (not undone)
        weight = 0.5;
      }
      return { ...r, quality, weight };
    });
  }

  getUnsyncedSessions(): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT * FROM sessions WHERE synced_at IS NULL'
    ).all() as Array<Record<string, unknown>>;
  }

  getUnsyncedRecords(limit = 500): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT cr.*, s.sequence_id, s.sequence_name, s.video_id FROM cut_records cr JOIN sessions s ON cr.session_id = s.id WHERE cr.synced_at IS NULL LIMIT ?'
    ).all(limit) as Array<Record<string, unknown>>;
  }

  markSynced(table: 'sessions' | 'cut_records', ids: number[]): void {
    if (ids.length === 0) return;
    const now = Date.now();
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(
      `UPDATE ${table} SET synced_at = ? WHERE id IN (${placeholders})`
    ).run(now, ...ids);
  }

  recordTrainingRun(trainingSize: number, accuracy: number, version: number): number {
    const stmt = this.db.prepare(
      'INSERT INTO model_training_runs (trained_at, training_size, accuracy, version) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(Date.now(), trainingSize, accuracy, version);
    return result.lastInsertRowid as number;
  }

  getLatestTrainingRun(): { id: number; trainedAt: number; trainingSize: number; accuracy: number; version: number } | null {
    return this.db.prepare(
      'SELECT id, trained_at as trainedAt, training_size as trainingSize, accuracy, version FROM model_training_runs ORDER BY trained_at DESC LIMIT 1'
    ).get() as { id: number; trainedAt: number; trainingSize: number; accuracy: number; version: number } | undefined ?? null;
  }

  close(): void {
    this.db.close();
  }
}
