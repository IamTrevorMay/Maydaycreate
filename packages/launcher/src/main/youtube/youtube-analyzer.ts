import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import type {
  AnalysisProgress,
  AnalysisOptions,
  VideoAnalysis,
  VideoAnalysisSummary,
  DetectedEffect,
  ExtractedFrame,
  TrainingStats,
  BatchQueueItem,
  YouTubeVideoInfo,
  ExportOptions,
  EffectPreset,
  CapturedEffect,
} from '@mayday/types';
import { YouTubeDB } from './youtube-db.js';
import { YtDlpService } from './ytdlp-service.js';
import { AnalysisPipeline } from './analysis-pipeline.js';
import { FrameDiffAnalyzer } from './frame-diff.js';
import { randomUUID } from 'crypto';
import { getServerBridge } from '../server-bridge.js';

type ProgressCallback = (progress: AnalysisProgress) => void;

export class YouTubeAnalyzer {
  private db: YouTubeDB;
  private ytdlp: YtDlpService;
  private pipeline: AnalysisPipeline;
  private progressListeners: ProgressCallback[] = [];
  private processingQueue = false;

  get database(): YouTubeDB {
    return this.db;
  }

  constructor() {
    const dataDir = path.join(app.getPath('userData'), 'youtube-analysis');
    this.db = new YouTubeDB(dataDir);
    this.ytdlp = new YtDlpService();
    this.pipeline = new AnalysisPipeline(this.db, dataDir);
  }

  // ── Video Info ───────────────────────────────────────────────────────────

  async getVideoInfo(url: string): Promise<YouTubeVideoInfo> {
    return this.ytdlp.getVideoInfo(url);
  }

  // ── Analysis ────────────────────────────────────────────────────────────

  async startAnalysis(url: string, options?: AnalysisOptions): Promise<string> {
    const info = await this.ytdlp.getVideoInfo(url);
    const analysisId = this.db.createAnalysis(info);

    // Run asynchronously
    this.pipeline.run(analysisId, url, (progress) => {
      for (const cb of this.progressListeners) cb(progress);
    }, options).then(() => {
      // After completion, try processing queue
      this.tryProcessQueue();
    });

    return analysisId;
  }

  cancelAnalysis(id: string): void {
    this.pipeline.cancel(id);
  }

  pauseAnalysis(id: string): void {
    this.pipeline.pause(id);
  }

  async resumeAnalysis(id: string, options?: AnalysisOptions): Promise<void> {
    const analysis = this.db.getAnalysis(id);
    if (!analysis) throw new Error('Analysis not found');
    if (analysis.status !== 'paused') throw new Error('Analysis is not paused');

    this.pipeline.resume(id, analysis.url, (progress) => {
      for (const cb of this.progressListeners) cb(progress);
    }, options).then(() => {
      this.tryProcessQueue();
    });
  }

  getAnalysis(id: string): VideoAnalysis | null {
    return this.db.getAnalysis(id);
  }

  listAnalyses(): VideoAnalysisSummary[] {
    return this.db.listAnalyses();
  }

  deleteAnalysis(id: string): boolean {
    const analysis = this.db.getAnalysis(id);
    if (analysis) {
      // Clean up files
      const analysisDir = path.join(app.getPath('userData'), 'youtube-analysis', id);
      try { fs.rmSync(analysisDir, { recursive: true, force: true }); } catch {}
    }
    return this.db.deleteAnalysis(id);
  }

  // ── Effects & Frames ──────────────────────────────────────────────────

  getEffects(analysisId: string): DetectedEffect[] {
    return this.db.getEffects(analysisId);
  }

  getFrames(analysisId: string): ExtractedFrame[] {
    return this.db.getFrames(analysisId);
  }

  // ── Rating & Training ────────────────────────────────────────────────

  rateEffect(effectId: string, rating: number, correctionNote?: string): void {
    this.db.rateEffect(effectId, rating, correctionNote);

    // If thumbs down with correction, save as training data
    if (rating === -1 && correctionNote) {
      const effect = this.db.getEffect(effectId);
      if (effect) {
        this.db.insertCorrection({
          effectId,
          analysisId: effect.analysisId,
          originalCategory: effect.category,
          correctedCategory: null,
          originalDescription: effect.description,
          correctionNote,
          frameBeforePath: effect.frameBefore,
          frameAfterPath: effect.frameAfter,
        });
      }
    }
  }

  getTrainingStats(): TrainingStats {
    return this.db.getTrainingStats();
  }

  // ── Shortcut Model ──────────────────────────────────────────────────

  async trainShortcutModel(): Promise<{ accuracy: number; examples: number }> {
    const frameDiff = new FrameDiffAnalyzer();
    const shortcutCache = this.pipeline.getShortcutCache();

    // Gather rated effects with corrections
    const trainingEffects = this.db.getTrainingEffects();

    // Gather no-effect pairs
    const noEffectPairs = this.db.getNoEffectPairs();

    const trainingData: Array<{ input: number[]; category: string }> = [];

    // Process rated effects — compute visual diff features for each
    for (const effect of trainingEffects) {
      if (!fs.existsSync(effect.frameBefore) || !fs.existsSync(effect.frameAfter)) continue;

      try {
        const diff = await frameDiff.computePairDiff(effect.frameBefore, effect.frameAfter, 0, 1);
        const analysis = this.db.getAnalysis(effect.analysisId);
        const duration = analysis?.duration || 0;

        // Build a minimal frame-like object for feature extraction
        const features = frameDiff.extractFeatures(
          diff,
          { id: '', analysisId: effect.analysisId, frameIndex: 0, timestamp: effect.startTime, filePath: effect.frameBefore, thumbnailPath: '', method: 'scene-detect', sceneScore: 0 },
          { id: '', analysisId: effect.analysisId, frameIndex: 1, timestamp: effect.endTime, filePath: effect.frameAfter, thumbnailPath: '', method: 'scene-detect', sceneScore: 0 },
          duration,
          [],
        );

        const category = effect.correctedCategory || effect.category;
        trainingData.push({ input: frameDiff.featuresToVector(features), category });
      } catch (err) {
        console.error('[Analyzer] Failed to compute features for training effect:', err);
      }
    }

    // Process no-effect pairs
    for (const pair of noEffectPairs) {
      if (!fs.existsSync(pair.frameBefore) || !fs.existsSync(pair.frameAfter)) continue;

      try {
        const diff = await frameDiff.computePairDiff(pair.frameBefore, pair.frameAfter, 0, 1);
        const analysis = this.db.getAnalysis(pair.analysisId);
        const duration = analysis?.duration || 0;

        const features = frameDiff.extractFeatures(
          diff,
          { id: '', analysisId: pair.analysisId, frameIndex: 0, timestamp: pair.timestampBefore, filePath: pair.frameBefore, thumbnailPath: '', method: 'interval', sceneScore: 0 },
          { id: '', analysisId: pair.analysisId, frameIndex: 1, timestamp: pair.timestampAfter, filePath: pair.frameAfter, thumbnailPath: '', method: 'interval', sceneScore: 0 },
          duration,
          [],
        );

        trainingData.push({ input: frameDiff.featuresToVector(features), category: 'no-effect' });
      } catch (err) {
        console.error('[Analyzer] Failed to compute features for no-effect pair:', err);
      }
    }

    console.log(`[Analyzer] Training shortcut model with ${trainingData.length} examples (${trainingEffects.length} rated effects + ${noEffectPairs.length} no-effect pairs)`);
    return shortcutCache.train(trainingData);
  }

  getShortcutModelStatus(): { ready: boolean; trained: boolean; accuracy: number; trainingExamples: number; modelPath: string } {
    return this.pipeline.getShortcutCache().getStatus();
  }

  // ── Preset Integration ──────────────────────────────────────────────

  async saveEffectAsPreset(effectId: string, presetName: string, tags?: string[]): Promise<string> {
    const effect = this.db.getEffect(effectId);
    if (!effect) throw new Error('Effect not found');

    // Build a synthetic CapturedEffect from the AI analysis
    const capturedEffects: CapturedEffect[] = effect.premiereRecreation.suggestedEffects.map((name, i) => ({
      displayName: name,
      matchName: name.replace(/\s+/g, '.'),
      index: i,
      isIntrinsic: false,
      properties: Object.entries(effect.premiereRecreation.estimatedParameters).map(([key, val]) => ({
        displayName: key,
        matchName: key.replace(/\s+/g, '.'),
        type: 0,
        value: val,
        keyframes: null,
      })),
    }));

    const now = new Date().toISOString();
    const preset: EffectPreset = {
      id: randomUUID(),
      name: presetName,
      version: 1,
      tags: tags || [effect.category],
      folder: 'youtube-analysis',
      description: `AI-detected: ${effect.description}\n\nRecreation steps:\n${effect.premiereRecreation.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      sourceClipName: `YouTube Analysis`,
      includeIntrinsics: false,
      createdAt: now,
      updatedAt: now,
      effects: capturedEffects,
    };

    // Try saving via preset-vault plugin
    const bridge = getServerBridge();
    if (bridge) {
      try {
        await bridge.lifecycle.executeCommand('preset-vault', 'save-synthetic', { preset });
      } catch {
        // Plugin may not be active; that's OK, the preset ID is still stored
      }
    }

    this.db.setSavedPresetId(effectId, preset.id);
    return preset.id;
  }

  // ── Queue ─────────────────────────────────────────────────────────────

  addToQueue(url: string, title?: string): string {
    return this.db.addToQueue(url, title);
  }

  removeFromQueue(id: string): void {
    this.db.removeFromQueue(id);
  }

  getQueue(): BatchQueueItem[] {
    return this.db.getQueue();
  }

  async processQueue(): Promise<void> {
    if (this.processingQueue || this.pipeline.activeCount > 0) return;
    this.processingQueue = true;
    try {
      await this.tryProcessQueue();
    } finally {
      this.processingQueue = false;
    }
  }

  private async tryProcessQueue(): Promise<void> {
    if (this.pipeline.activeCount > 0) return;

    const next = this.db.getNextQueued();
    if (!next) return;

    this.db.updateQueueItem(next.id, 'processing');
    try {
      const analysisId = await this.startAnalysis(next.url);
      this.db.updateQueueItem(next.id, 'complete', analysisId);
    } catch {
      this.db.updateQueueItem(next.id, 'error');
    }
  }

  // ── Export ─────────────────────────────────────────────────────────────

  exportAnalysis(options: ExportOptions): string {
    const analysis = this.db.getAnalysis(options.analysisId);
    if (!analysis) throw new Error('Analysis not found');
    const effects = this.db.getEffects(options.analysisId);

    if (options.format === 'json') {
      return JSON.stringify({ analysis, effects }, null, 2);
    }

    // Markdown export
    let md = `# Video Analysis: ${analysis.title}\n\n`;
    md += `**Channel:** ${analysis.channel}\n`;
    md += `**Duration:** ${analysis.duration.toFixed(0)}s\n`;
    md += `**URL:** ${analysis.url}\n\n`;

    if (analysis.summary) md += `## Summary\n${analysis.summary}\n\n`;
    if (analysis.styleNotes) md += `## Style Notes\n${analysis.styleNotes}\n\n`;

    md += `## Detected Effects (${effects.length})\n\n`;

    for (const e of effects) {
      md += `### ${e.effectIndex + 1}. ${e.category} (${e.confidence} confidence)\n`;
      md += `**Time:** ${e.startTime.toFixed(1)}s - ${e.endTime.toFixed(1)}s\n\n`;
      md += `${e.description}\n\n`;

      if (e.premiereRecreation.steps.length > 0) {
        md += `**Premiere Pro Recreation:**\n`;
        e.premiereRecreation.steps.forEach((step, i) => {
          md += `${i + 1}. ${step}\n`;
        });
        md += '\n';
      }

      if (e.premiereRecreation.suggestedEffects.length > 0) {
        md += `**Suggested Effects:** ${e.premiereRecreation.suggestedEffects.join(', ')}\n\n`;
      }

      if (options.includeFramePaths) {
        md += `**Frames:** ${e.frameBefore} → ${e.frameAfter}\n\n`;
      }

      md += '---\n\n';
    }

    return md;
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
