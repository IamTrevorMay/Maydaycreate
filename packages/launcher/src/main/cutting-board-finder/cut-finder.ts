import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type {
  CutFinderProgress,
  CutFinderAnalysis,
  CutFinderAnalysisSummary,
  CutFinderExportOptions,
  DetectedCut,
  ExtractedFrame,
  YouTubeVideoInfo,
} from '@mayday/types';
import { CutFinderDB } from './cut-finder-db.js';
import { YtDlpService } from '../youtube/ytdlp-service.js';
import { CutFinderPipeline } from './cut-finder-pipeline.js';

type ProgressCallback = (progress: CutFinderProgress) => void;

export class CutFinder {
  private db: CutFinderDB;
  private ytdlp: YtDlpService;
  private pipeline: CutFinderPipeline;
  private progressListeners: ProgressCallback[] = [];

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'cut-finder');
    this.db = new CutFinderDB(dataDir);
    this.ytdlp = new YtDlpService();
    this.pipeline = new CutFinderPipeline(this.db);
  }

  // ── Video Info ───────────────────────────────────────────────────────────

  async getVideoInfo(url: string): Promise<YouTubeVideoInfo> {
    return this.ytdlp.getVideoInfo(url);
  }

  // ── Analysis ────────────────────────────────────────────────────────────

  async startAnalysis(url: string): Promise<string> {
    const info = await this.ytdlp.getVideoInfo(url);
    const analysisId = this.db.createAnalysis(info);

    this.pipeline.run(analysisId, url, (progress) => {
      for (const cb of this.progressListeners) cb(progress);
    });

    return analysisId;
  }

  cancelAnalysis(id: string): void {
    this.pipeline.cancel(id);
    const analysis = this.db.getAnalysis(id);
    if (analysis && !['complete', 'cancelled'].includes(analysis.status)) {
      this.db.updateStatus(id, 'cancelled');
    }
  }

  pauseAnalysis(id: string): void {
    this.pipeline.pause(id);
  }

  async resumeAnalysis(id: string): Promise<void> {
    const analysis = this.db.getAnalysis(id);
    if (!analysis) throw new Error('Analysis not found');

    const resumableStatuses = ['paused', 'downloading', 'extracting', 'detecting', 'error'];
    if (!resumableStatuses.includes(analysis.status)) {
      throw new Error(`Analysis cannot be resumed (status: ${analysis.status})`);
    }

    const pauseIndex = this.db.getPauseFrameIndex(id);
    const frames = this.db.getFrames(id);
    const canResume = frames.length >= 2;

    if (canResume) {
      const resumeIndex = pauseIndex ?? 0;
      this.db.pauseAnalysis(id, resumeIndex);
      this.pipeline.resume(id, (progress) => {
        for (const cb of this.progressListeners) cb(progress);
      }).catch((err) => {
        console.error('[CutFinder] resume failed:', err);
      });
    } else {
      this.db.resetAnalysisData(id);
      this.pipeline.run(id, analysis.url, (progress) => {
        for (const cb of this.progressListeners) cb(progress);
      }).catch((err) => {
        console.error('[CutFinder] restart failed:', err);
      });
    }
  }

  getAnalysis(id: string): CutFinderAnalysis | null {
    return this.db.getAnalysis(id);
  }

  listAnalyses(): CutFinderAnalysisSummary[] {
    return this.db.listAnalyses();
  }

  deleteAnalysis(id: string): boolean {
    const analysis = this.db.getAnalysis(id);
    if (analysis) {
      const analysisDir = path.join(app.getPath('userData'), 'cut-finder', id);
      try { fs.rmSync(analysisDir, { recursive: true, force: true }); } catch {}
    }
    return this.db.deleteAnalysis(id);
  }

  // ── Cuts & Frames ──────────────────────────────────────────────────────

  getCuts(analysisId: string): DetectedCut[] {
    return this.db.getCuts(analysisId);
  }

  getFrames(analysisId: string): ExtractedFrame[] {
    return this.db.getFrames(analysisId);
  }

  setIntentTags(cutId: string, tags: string[]): void {
    this.db.setIntentTags(cutId, tags);
  }

  // ── Export ─────────────────────────────────────────────────────────────

  exportAnalysis(options: CutFinderExportOptions): string {
    const analysis = this.db.getAnalysis(options.analysisId);
    if (!analysis) throw new Error('Analysis not found');
    const cuts = this.db.getCuts(options.analysisId);

    if (options.format === 'json') {
      return JSON.stringify({ analysis, cuts }, null, 2);
    }

    if (options.format === 'edl') {
      return this.exportEDL(analysis, cuts);
    }

    // Markdown export
    let md = `# Cut Detection: ${analysis.title}\n\n`;
    md += `**Channel:** ${analysis.channel}\n`;
    md += `**Duration:** ${analysis.duration.toFixed(0)}s\n`;
    md += `**URL:** ${analysis.url}\n\n`;
    md += `## Detected Cuts (${cuts.length})\n\n`;

    for (const c of cuts) {
      md += `${c.cutIndex + 1}. **${formatTimecode(c.timestamp)}** (${c.confidence} confidence, diff: ${(c.diffScore * 100).toFixed(0)}%)\n`;
    }

    return md;
  }

  private exportEDL(analysis: CutFinderAnalysis, cuts: DetectedCut[]): string {
    let edl = `TITLE: ${analysis.title}\nFCM: NON-DROP FRAME\n\n`;
    const fps = 30; // Default EDL framerate

    for (let i = 0; i < cuts.length; i++) {
      const startTc = secondsToTimecode(i === 0 ? 0 : cuts[i - 1].timestamp, fps);
      const endTc = secondsToTimecode(cuts[i].timestamp, fps);
      edl += `${String(i + 1).padStart(3, '0')}  AX       V     C        ${startTc} ${endTc} ${startTc} ${endTc}\n`;
    }

    return edl;
  }

  // ── Events ────────────────────────────────────────────────────────────

  onProgress(cb: ProgressCallback): () => void {
    this.progressListeners.push(cb);
    return () => {
      this.progressListeners = this.progressListeners.filter(l => l !== cb);
    };
  }

  destroy(): void {
    this.db.close();
  }
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function secondsToTimecode(seconds: number, fps: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * fps);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}
