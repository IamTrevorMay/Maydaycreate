import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3').default;
import type {
  CutFinderAnalysis,
  CutFinderAnalysisSummary,
  CutFinderStatus,
  DetectedCut,
  ExtractedFrame,
  YouTubeVideoInfo,
} from '@mayday/types';

export class CutFinderDB {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'cut-finder.db'));
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
        status TEXT NOT NULL DEFAULT 'queued',
        video_path TEXT,
        frames_dir TEXT,
        frame_count INTEGER DEFAULT 0,
        cut_count INTEGER DEFAULT 0,
        error TEXT,
        analysis_time_ms INTEGER,
        pause_frame_index INTEGER,
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

      CREATE TABLE IF NOT EXISTS cuts (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        cut_index INTEGER NOT NULL,
        timestamp REAL NOT NULL,
        confidence TEXT NOT NULL DEFAULT 'medium',
        frame_before TEXT,
        frame_after TEXT,
        diff_score REAL NOT NULL,
        intent_tags TEXT DEFAULT '[]',
        video_id TEXT
      );
    `);
  }

  // ── Analyses ──────────────────────────────────────────────────────────────

  createAnalysis(info: YouTubeVideoInfo): string {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO analyses (id, video_id, url, title, channel, duration, thumbnail_url, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
    `).run(id, info.videoId, info.url, info.title, info.channel, info.duration, info.thumbnailUrl, new Date().toISOString());
    return id;
  }

  updateStatus(id: string, status: CutFinderStatus, error?: string): void {
    if (error) {
      this.db.prepare('UPDATE analyses SET status = ?, error = ? WHERE id = ?').run(status, error, id);
    } else {
      this.db.prepare('UPDATE analyses SET status = ? WHERE id = ?').run(status, id);
    }
  }

  setVideoPath(id: string, videoPath: string): void {
    this.db.prepare('UPDATE analyses SET video_path = ? WHERE id = ?').run(videoPath, id);
  }

  setFramesDir(id: string, framesDir: string, frameCount: number): void {
    this.db.prepare('UPDATE analyses SET frames_dir = ?, frame_count = ? WHERE id = ?').run(framesDir, frameCount, id);
  }

  setThumbnailPath(id: string, thumbnailPath: string): void {
    this.db.prepare('UPDATE analyses SET thumbnail_path = ? WHERE id = ?').run(thumbnailPath, id);
  }

  completeAnalysis(id: string, analysisTimeMs: number): void {
    const cutCount = this.db.prepare('SELECT COUNT(*) as count FROM cuts WHERE analysis_id = ?').get(id) as { count: number };
    this.db.prepare(`
      UPDATE analyses SET status = 'complete', cut_count = ?, analysis_time_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(cutCount.count, analysisTimeMs, new Date().toISOString(), id);
  }

  pauseAnalysis(id: string, frameIndex: number): void {
    this.db.prepare('UPDATE analyses SET status = ?, pause_frame_index = ? WHERE id = ?').run('paused', frameIndex, id);
  }

  getPauseFrameIndex(id: string): number | null {
    const row = this.db.prepare('SELECT pause_frame_index FROM analyses WHERE id = ?').get(id) as { pause_frame_index: number | null } | undefined;
    return row?.pause_frame_index ?? null;
  }

  getAnalysis(id: string): CutFinderAnalysis | null {
    const row = this.db.prepare('SELECT * FROM analyses WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapAnalysis(row);
  }

  listAnalyses(): CutFinderAnalysisSummary[] {
    const rows = this.db.prepare(`
      SELECT id, title, channel, duration, thumbnail_url, thumbnail_path, status, cut_count, frame_count, created_at
      FROM analyses ORDER BY created_at DESC
    `).all() as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      title: r.title as string,
      channel: r.channel as string,
      duration: r.duration as number,
      thumbnailUrl: (r.thumbnail_url as string) || '',
      thumbnailPath: (r.thumbnail_path as string) || '',
      status: r.status as CutFinderStatus,
      cutCount: (r.cut_count as number) || 0,
      frameCount: (r.frame_count as number) || 0,
      createdAt: r.created_at as string,
    }));
  }

  resetAnalysisData(id: string): void {
    this.db.prepare('DELETE FROM cuts WHERE analysis_id = ?').run(id);
    this.db.prepare('DELETE FROM frames WHERE analysis_id = ?').run(id);
    this.db.prepare('UPDATE analyses SET frame_count = 0, cut_count = 0, pause_frame_index = NULL, video_path = NULL, frames_dir = NULL, error = NULL WHERE id = ?').run(id);
  }

  deleteAnalysis(id: string): boolean {
    const result = this.db.prepare('DELETE FROM analyses WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ── Frames ────────────────────────────────────────────────────────────────

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

  // ── Cuts ───────────────────────────────────────────────────────────────────

  insertCut(cut: DetectedCut, videoId?: string): void {
    this.db.prepare(`
      INSERT INTO cuts (id, analysis_id, cut_index, timestamp, confidence, frame_before, frame_after, diff_score, video_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(cut.id, cut.analysisId, cut.cutIndex, cut.timestamp, cut.confidence, cut.frameBefore, cut.frameAfter, cut.diffScore, videoId ?? null);
  }

  getCuts(analysisId: string): DetectedCut[] {
    const rows = this.db.prepare('SELECT * FROM cuts WHERE analysis_id = ? ORDER BY timestamp').all(analysisId) as Record<string, unknown>[];
    return rows.map(r => ({
      id: r.id as string,
      analysisId: r.analysis_id as string,
      cutIndex: r.cut_index as number,
      timestamp: r.timestamp as number,
      confidence: (r.confidence as DetectedCut['confidence']) || 'medium',
      frameBefore: (r.frame_before as string) || '',
      frameAfter: (r.frame_after as string) || '',
      diffScore: r.diff_score as number,
      intentTags: (() => { try { return JSON.parse((r.intent_tags as string) || '[]'); } catch { return []; } })(),
      videoId: (r.video_id as string) || undefined,
    }));
  }

  setIntentTags(cutId: string, tags: string[]): void {
    this.db.prepare('UPDATE cuts SET intent_tags = ? WHERE id = ?').run(JSON.stringify(tags), cutId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  private mapAnalysis(r: Record<string, unknown>): CutFinderAnalysis {
    return {
      id: r.id as string,
      videoId: r.video_id as string,
      url: r.url as string,
      title: r.title as string,
      channel: r.channel as string,
      duration: r.duration as number,
      thumbnailUrl: (r.thumbnail_url as string) || '',
      thumbnailPath: (r.thumbnail_path as string) || '',
      status: r.status as CutFinderStatus,
      videoPath: (r.video_path as string) || '',
      framesDir: (r.frames_dir as string) || '',
      frameCount: (r.frame_count as number) || 0,
      cutCount: (r.cut_count as number) || 0,
      error: (r.error as string) || '',
      analysisTimeMs: (r.analysis_time_ms as number) || 0,
      createdAt: r.created_at as string,
      completedAt: (r.completed_at as string) || '',
    };
  }
}
