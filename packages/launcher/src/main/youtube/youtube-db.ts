import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

// Use createRequire to load the native module so rollup doesn't try to bundle it
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
import type {
  VideoAnalysis,
  VideoAnalysisSummary,
  ExtractedFrame,
  DetectedEffect,
  TrainingCorrection,
  TrainingStats,
  BatchQueueItem,
  YouTubeVideoInfo,
  AnalysisStatus,
  PremiereRecreation,
  EffectCategory,
} from '@mayday/types';

export class YouTubeDB {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'youtube.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        id TEXT PRIMARY KEY,
        video_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        channel TEXT NOT NULL,
        duration REAL NOT NULL,
        thumbnail_url TEXT,
        thumbnail_path TEXT,
        upload_date TEXT,
        description TEXT,
        resolution TEXT,
        fps REAL,
        status TEXT NOT NULL DEFAULT 'queued',
        video_path TEXT,
        frames_dir TEXT,
        frame_count INTEGER DEFAULT 0,
        effect_count INTEGER DEFAULT 0,
        summary TEXT DEFAULT '',
        style_notes TEXT DEFAULT '',
        error TEXT,
        analysis_time_ms INTEGER,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS frames (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        frame_index INTEGER NOT NULL,
        timestamp REAL NOT NULL,
        file_path TEXT NOT NULL,
        thumbnail_path TEXT NOT NULL,
        method TEXT NOT NULL,
        scene_score REAL
      );

      CREATE TABLE IF NOT EXISTS effects (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        effect_index INTEGER NOT NULL,
        start_time REAL NOT NULL,
        end_time REAL NOT NULL,
        category TEXT NOT NULL,
        secondary_categories TEXT DEFAULT '[]',
        description TEXT NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        frame_before TEXT,
        frame_after TEXT,
        premiere_recreation TEXT DEFAULT '{}',
        rating INTEGER,
        correction_note TEXT,
        source_identification TEXT,
        saved_preset_id TEXT
      );

      CREATE TABLE IF NOT EXISTS corrections (
        id TEXT PRIMARY KEY,
        effect_id TEXT NOT NULL REFERENCES effects(id) ON DELETE CASCADE,
        analysis_id TEXT NOT NULL,
        original_category TEXT NOT NULL,
        corrected_category TEXT,
        original_description TEXT NOT NULL,
        correction_note TEXT NOT NULL,
        frame_before_path TEXT,
        frame_after_path TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS batch_queue (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        title TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        position INTEGER NOT NULL,
        analysis_id TEXT
      );
    `);

    // Migration: add synced_at columns for Supabase sync
    const cols = this.db.prepare("PRAGMA table_info(analyses)").all() as Array<{ name: string }>;
    if (!cols.some(c => c.name === 'synced_at')) {
      this.db.exec(`
        ALTER TABLE analyses ADD COLUMN synced_at TEXT;
        ALTER TABLE effects ADD COLUMN synced_at TEXT;
        ALTER TABLE corrections ADD COLUMN synced_at TEXT;
      `);
    }

    // Migration: add pause_frame_index column for pause/resume
    if (!cols.some(c => c.name === 'pause_frame_index')) {
      this.db.exec(`ALTER TABLE analyses ADD COLUMN pause_frame_index INTEGER`);
    }

    // Migration: convert old -1/1 ratings to 1-5 scale
    const hasLegacyRatings = (this.db.prepare('SELECT COUNT(*) as c FROM effects WHERE rating = -1').get() as { c: number }).c > 0;
    if (hasLegacyRatings) {
      this.db.exec(`
        UPDATE effects SET rating = 2 WHERE rating = -1;
        UPDATE effects SET rating = 4 WHERE rating = 1;
      `);
    }

    // Migration: add source column to effects + no_effect_pairs table
    const effectCols = this.db.prepare("PRAGMA table_info(effects)").all() as Array<{ name: string }>;
    if (!effectCols.some(c => c.name === 'source')) {
      this.db.exec(`ALTER TABLE effects ADD COLUMN source TEXT NOT NULL DEFAULT 'ai'`);
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS no_effect_pairs (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        frame_before TEXT NOT NULL,
        frame_after TEXT NOT NULL,
        timestamp_before REAL NOT NULL,
        timestamp_after REAL NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ── Analyses ──────────────────────────────────────────────────────────────

  createAnalysis(info: YouTubeVideoInfo): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO analyses (id, video_id, url, title, channel, duration, thumbnail_url, upload_date, description, resolution, fps, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)
    `).run(id, info.videoId, info.url, info.title, info.channel, info.duration, info.thumbnailUrl, info.uploadDate, info.description, info.resolution, info.fps, new Date().toISOString());
    return id;
  }

  updateAnalysisStatus(id: string, status: AnalysisStatus, error?: string): void {
    if (error) {
      this.db.prepare('UPDATE analyses SET status = ?, error = ? WHERE id = ?').run(status, error, id);
    } else {
      this.db.prepare('UPDATE analyses SET status = ? WHERE id = ?').run(status, id);
    }
  }

  setAnalysisVideoPath(id: string, videoPath: string): void {
    this.db.prepare('UPDATE analyses SET video_path = ? WHERE id = ?').run(videoPath, id);
  }

  setAnalysisFramesDir(id: string, framesDir: string, frameCount: number): void {
    this.db.prepare('UPDATE analyses SET frames_dir = ?, frame_count = ? WHERE id = ?').run(framesDir, frameCount, id);
  }

  setAnalysisThumbnailPath(id: string, thumbnailPath: string): void {
    this.db.prepare('UPDATE analyses SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, id);
  }

  completeAnalysis(id: string, summary: string, styleNotes: string, analysisTimeMs: number): void {
    const effectCount = this.db.prepare('SELECT COUNT(*) as count FROM effects WHERE analysis_id = ?').get(id) as { count: number };
    this.db.prepare(`
      UPDATE analyses SET status = 'complete', summary = ?, style_notes = ?, effect_count = ?, analysis_time_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(summary, styleNotes, effectCount.count, analysisTimeMs, new Date().toISOString(), id);
  }

  pauseAnalysis(id: string, frameIndex: number): void {
    this.db.prepare('UPDATE analyses SET status = ?, pause_frame_index = ? WHERE id = ?').run('paused', frameIndex, id);
  }

  getPauseFrameIndex(id: string): number | null {
    const row = this.db.prepare('SELECT pause_frame_index FROM analyses WHERE id = ?').get(id) as { pause_frame_index: number | null } | undefined;
    return row?.pause_frame_index ?? null;
  }

  getAnalysis(id: string): VideoAnalysis | null {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapAnalysis(row);
  }

  listAnalyses(): VideoAnalysisSummary[] {
    const rows = this.db.prepare('SELECT id, title, channel, duration, thumbnail_url, thumbnail_path, status, effect_count, created_at FROM analyses ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      title: r.title as string,
      channel: r.channel as string,
      duration: r.duration as number,
      thumbnailUrl: (r.thumbnail_url as string) || '',
      thumbnailPath: (r.thumbnail_path as string) || '',
      status: r.status as AnalysisStatus,
      effectCount: (r.effect_count as number) || 0,
      createdAt: r.created_at as string,
    }));
  }

  deleteAnalysis(id: string): boolean {
    const result = this.db.prepare('DELETE FROM analyses WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Frames ────────────────────────────────────────────────────────────────

  insertFrame(frame: ExtractedFrame): void {
    this.db.prepare(`
      INSERT INTO frames (id, analysis_id, frame_index, timestamp, file_path, thumbnail_path, method, scene_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(frame.id, frame.analysisId, frame.frameIndex, frame.timestamp, frame.filePath, frame.thumbnailPath, frame.method, frame.sceneScore);
  }

  insertFrames(frames: ExtractedFrame[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO frames (id, analysis_id, frame_index, timestamp, file_path, thumbnail_path, method, scene_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((items: ExtractedFrame[]) => {
      for (const f of items) {
        stmt.run(f.id, f.analysisId, f.frameIndex, f.timestamp, f.filePath, f.thumbnailPath, f.method, f.sceneScore);
      }
    });
    tx(frames);
  }

  getFrames(analysisId: string): ExtractedFrame[] {
    const rows = this.db.prepare('SELECT * FROM frames WHERE analysis_id = ? ORDER BY timestamp').all(analysisId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      analysisId: r.analysis_id as string,
      frameIndex: r.frame_index as number,
      timestamp: r.timestamp as number,
      filePath: r.file_path as string,
      thumbnailPath: r.thumbnail_path as string,
      method: r.method as ExtractedFrame['method'],
      sceneScore: r.scene_score as number | null,
    }));
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  insertEffect(effect: DetectedEffect): void {
    this.db.prepare(`
      INSERT INTO effects (id, analysis_id, effect_index, start_time, end_time, category, secondary_categories, description, confidence, frame_before, frame_after, premiere_recreation, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      effect.id, effect.analysisId, effect.effectIndex, effect.startTime, effect.endTime,
      effect.category, JSON.stringify(effect.secondaryCategories), effect.description,
      effect.confidence, effect.frameBefore, effect.frameAfter,
      JSON.stringify(effect.premiereRecreation),
      effect.source || 'ai',
    );
  }

  getEffects(analysisId: string): DetectedEffect[] {
    const rows = this.db.prepare('SELECT * FROM effects WHERE analysis_id = ? ORDER BY start_time').all(analysisId) as Record<string, unknown>[];
    return rows.map(r => this.mapEffect(r));
  }

  getEffect(id: string): DetectedEffect | null {
    const row = this.db.prepare('SELECT * FROM effects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapEffect(row);
  }

  rateEffect(id: string, rating: number, correctionNote?: string): void {
    this.db.prepare('UPDATE effects SET rating = ?, correction_note = ? WHERE id = ?').run(rating, correctionNote || null, id);
  }

  setSavedPresetId(effectId: string, presetId: string): void {
    this.db.prepare('UPDATE effects SET saved_preset_id = ? WHERE id = ?').run(presetId, effectId);
  }

  setSourceIdentification(effectId: string, source: string): void {
    this.db.prepare('UPDATE effects SET source_identification = ? WHERE id = ?').run(source, effectId);
  }

  // ── Corrections ───────────────────────────────────────────────────────────

  insertCorrection(correction: Omit<TrainingCorrection, 'id' | 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO corrections (id, effect_id, analysis_id, original_category, corrected_category, original_description, correction_note, frame_before_path, frame_after_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(), correction.effectId, correction.analysisId,
      correction.originalCategory, correction.correctedCategory,
      correction.originalDescription, correction.correctionNote,
      correction.frameBeforePath, correction.frameAfterPath,
      new Date().toISOString(),
    );
  }

  getCorrections(): TrainingCorrection[] {
    const rows = this.db.prepare('SELECT * FROM corrections ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      effectId: r.effect_id as string,
      analysisId: r.analysis_id as string,
      originalCategory: r.original_category as string,
      correctedCategory: (r.corrected_category as string) || null,
      originalDescription: r.original_description as string,
      correctionNote: r.correction_note as string,
      frameBeforePath: (r.frame_before_path as string) || '',
      frameAfterPath: (r.frame_after_path as string) || '',
      createdAt: r.created_at as string,
    }));
  }

  getTrainingStats(): TrainingStats {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM effects').get() as { c: number }).c;
    const rated = (this.db.prepare('SELECT COUNT(*) as c FROM effects WHERE rating IS NOT NULL').get() as { c: number }).c;
    const corrections = (this.db.prepare('SELECT COUNT(*) as c FROM corrections').get() as { c: number }).c;

    // Count per rating level (1-5)
    const dist: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    for (let i = 1; i <= 5; i++) {
      dist[i - 1] = (this.db.prepare('SELECT COUNT(*) as c FROM effects WHERE rating = ?').get(i) as { c: number }).c;
    }

    // Derive thumbsUp (4-5) and thumbsDown (1-2) for backward compat
    const up = dist[3] + dist[4];
    const down = dist[0] + dist[1];

    const sumRatings = dist.reduce((sum, count, idx) => sum + count * (idx + 1), 0);
    const averageRating = rated > 0 ? Math.round((sumRatings / rated) * 10) / 10 : 0;

    return {
      totalEffects: total,
      ratedEffects: rated,
      thumbsUp: up,
      thumbsDown: down,
      corrections,
      accuracyPercent: rated > 0 ? Math.round((up / rated) * 100) : 0,
      ratingDistribution: dist,
      averageRating,
    };
  }

  // ── No-Effect Pairs ──────────────────────────────────────────────────

  insertNoEffectPair(analysisId: string, frameBefore: string, frameAfter: string, timestampBefore: number, timestampAfter: number): void {
    this.db.prepare(`
      INSERT INTO no_effect_pairs (id, analysis_id, frame_before, frame_after, timestamp_before, timestamp_after, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), analysisId, frameBefore, frameAfter, timestampBefore, timestampAfter, new Date().toISOString());
  }

  getNoEffectPairs(): Array<{ analysisId: string; frameBefore: string; frameAfter: string; timestampBefore: number; timestampAfter: number }> {
    const rows = this.db.prepare('SELECT * FROM no_effect_pairs').all() as Record<string, unknown>[];
    return rows.map(r => ({
      analysisId: r.analysis_id as string,
      frameBefore: r.frame_before as string,
      frameAfter: r.frame_after as string,
      timestampBefore: r.timestamp_before as number,
      timestampAfter: r.timestamp_after as number,
    }));
  }

  // ── Training Data ──────────────────────────────────────────────────

  getTrainingEffects(): Array<DetectedEffect & { correctedCategory: string | null }> {
    const rows = this.db.prepare(`
      SELECT e.*, c.corrected_category
      FROM effects e
      LEFT JOIN corrections c ON c.effect_id = e.id
      WHERE e.rating IS NOT NULL
      ORDER BY e.start_time
    `).all() as Record<string, unknown>[];
    return rows.map(r => ({
      ...this.mapEffect(r),
      correctedCategory: (r.corrected_category as string) || null,
    }));
  }

  // ── Queue ─────────────────────────────────────────────────────────────────

  addToQueue(url: string, title?: string): string {
    const id = randomUUID();
    const maxPos = (this.db.prepare('SELECT MAX(position) as m FROM batch_queue').get() as { m: number | null }).m ?? -1;
    this.db.prepare('INSERT INTO batch_queue (id, url, title, status, position) VALUES (?, ?, ?, ?, ?)').run(id, url, title || '', 'queued', maxPos + 1);
    return id;
  }

  getQueue(): BatchQueueItem[] {
    const rows = this.db.prepare('SELECT * FROM batch_queue ORDER BY position').all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      url: r.url as string,
      title: (r.title as string) || '',
      status: r.status as BatchQueueItem['status'],
      position: r.position as number,
      analysisId: (r.analysis_id as string) || null,
    }));
  }

  getNextQueued(): BatchQueueItem | null {
    const row = this.db.prepare("SELECT * FROM batch_queue WHERE status = 'queued' ORDER BY position LIMIT 1").get() as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      url: row.url as string,
      title: (row.title as string) || '',
      status: row.status as BatchQueueItem['status'],
      position: row.position as number,
      analysisId: (row.analysis_id as string) || null,
    };
  }

  updateQueueItem(id: string, status: BatchQueueItem['status'], analysisId?: string): void {
    if (analysisId) {
      this.db.prepare('UPDATE batch_queue SET status = ?, analysis_id = ? WHERE id = ?').run(status, analysisId, id);
    } else {
      this.db.prepare('UPDATE batch_queue SET status = ? WHERE id = ?').run(status, id);
    }
  }

  removeFromQueue(id: string): void {
    this.db.prepare('DELETE FROM batch_queue WHERE id = ?').run(id);
  }

  // ── Sync ─────────────────────────────────────────────────────────────────

  getUnsyncedAnalyses(): Record<string, unknown>[] {
    return this.db.prepare(
      "SELECT * FROM analyses WHERE status = 'complete' AND synced_at IS NULL"
    ).all() as Record<string, unknown>[];
  }

  getUnsyncedEffects(limit = 500): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT * FROM effects WHERE synced_at IS NULL LIMIT ?'
    ).all(limit) as Record<string, unknown>[];
  }

  getUnsyncedCorrections(): Record<string, unknown>[] {
    return this.db.prepare(
      'SELECT * FROM corrections WHERE synced_at IS NULL'
    ).all() as Record<string, unknown>[];
  }

  markSynced(table: 'analyses' | 'effects' | 'corrections', ids: string[]): void {
    if (ids.length === 0) return;
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`UPDATE ${table} SET synced_at = ? WHERE id = ?`);
    const tx = this.db.transaction((items: string[]) => {
      for (const id of items) stmt.run(now, id);
    });
    tx(ids);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  private mapAnalysis(r: Record<string, unknown>): VideoAnalysis {
    return {
      id: r.id as string,
      videoId: r.video_id as string,
      url: r.url as string,
      title: r.title as string,
      channel: r.channel as string,
      duration: r.duration as number,
      thumbnailUrl: (r.thumbnail_url as string) || '',
      thumbnailPath: (r.thumbnail_path as string) || '',
      uploadDate: (r.upload_date as string) || '',
      description: (r.description as string) || '',
      resolution: (r.resolution as string) || '',
      fps: (r.fps as number) || 0,
      status: r.status as AnalysisStatus,
      videoPath: (r.video_path as string) || '',
      framesDir: (r.frames_dir as string) || '',
      frameCount: (r.frame_count as number) || 0,
      effectCount: (r.effect_count as number) || 0,
      summary: (r.summary as string) || '',
      styleNotes: (r.style_notes as string) || '',
      error: (r.error as string) || '',
      analysisTimeMs: (r.analysis_time_ms as number) || 0,
      createdAt: r.created_at as string,
      completedAt: (r.completed_at as string) || '',
    };
  }

  private mapEffect(r: Record<string, unknown>): DetectedEffect {
    let premiere: PremiereRecreation = { steps: [], suggestedEffects: [], estimatedParameters: {}, notes: '' };
    try { premiere = JSON.parse((r.premiere_recreation as string) || '{}'); } catch {}
    let secondary: EffectCategory[] = [];
    try { secondary = JSON.parse((r.secondary_categories as string) || '[]'); } catch {}

    return {
      id: r.id as string,
      analysisId: r.analysis_id as string,
      effectIndex: r.effect_index as number,
      startTime: r.start_time as number,
      endTime: r.end_time as number,
      category: r.category as EffectCategory,
      secondaryCategories: secondary,
      description: r.description as string,
      confidence: (r.confidence as DetectedEffect['confidence']) || 'medium',
      frameBefore: (r.frame_before as string) || '',
      frameAfter: (r.frame_after as string) || '',
      premiereRecreation: premiere,
      rating: r.rating as number | null,
      correctionNote: (r.correction_note as string) || '',
      sourceIdentification: (r.source_identification as string) || '',
      savedPresetId: (r.saved_preset_id as string) || null,
      source: (r.source as 'ai' | 'local') || 'ai',
    };
  }
}
