import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { AnalysisProgress, AnalysisOptions, DetectedEffect, ExtractedFrame } from '@mayday/types';
import { YouTubeDB } from './youtube-db.js';
import { YtDlpService } from './ytdlp-service.js';
import { FrameExtractor } from './frame-extractor.js';
import { VisionAnalyzer } from './vision-analyzer.js';
import { FrameDiffAnalyzer, PRE_FILTER_THRESHOLD } from './frame-diff.js';
import type { FramePairDiff } from './frame-diff.js';
import { ShortcutCache } from './shortcut-cache.js';

type ProgressCallback = (progress: AnalysisProgress) => void;

export class AnalysisPipeline {
  private db: YouTubeDB;
  private ytdlp: YtDlpService;
  private frameExtractor: FrameExtractor;
  private vision: VisionAnalyzer;
  private frameDiff: FrameDiffAnalyzer;
  private shortcutCache: ShortcutCache;
  private abortControllers = new Map<string, AbortController>();
  private pauseFlags = new Map<string, boolean>();
  private progressCallbacks = new Map<string, ProgressCallback>();

  constructor(db: YouTubeDB, dataDir: string) {
    this.db = db;
    this.ytdlp = new YtDlpService();
    this.frameExtractor = new FrameExtractor();
    this.vision = new VisionAnalyzer();
    this.frameDiff = new FrameDiffAnalyzer();
    this.shortcutCache = new ShortcutCache(dataDir);
  }

  getShortcutCache(): ShortcutCache {
    return this.shortcutCache;
  }

  async run(
    analysisId: string,
    url: string,
    onProgress: ProgressCallback,
    options?: AnalysisOptions,
  ): Promise<void> {
    const ac = new AbortController();
    this.abortControllers.set(analysisId, ac);
    this.progressCallbacks.set(analysisId, onProgress);
    const startTime = Date.now();

    const dataDir = path.join(app.getPath('userData'), 'youtube-analysis', analysisId);
    fs.mkdirSync(dataDir, { recursive: true });

    try {
      // Phase 1: Download
      this.checkAbort(ac);
      this.db.updateAnalysisStatus(analysisId, 'downloading');
      onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: 0, detail: 'Starting download...' });

      const videoPath = await this.ytdlp.download(url, dataDir, (percent) => {
        onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: Math.min(percent, 99), detail: `${percent.toFixed(0)}%` });
      });
      this.db.setAnalysisVideoPath(analysisId, videoPath);

      // Download thumbnail
      const thumbPath = path.join(dataDir, 'thumbnail.png');
      const thumbResult = await this.ytdlp.downloadThumbnail(url, thumbPath);
      if (thumbResult) {
        this.db.setAnalysisThumbnailPath(analysisId, thumbResult);
      }

      onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: 100, detail: 'Download complete' });

      // Check pause between phases
      if (this.checkPause(analysisId, 0, onProgress)) return;

      // Phase 2: Extract frames
      this.checkAbort(ac);
      this.db.updateAnalysisStatus(analysisId, 'extracting');
      onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 0, detail: 'Starting frame extraction...' });

      const framesDir = path.join(dataDir, 'extracted');
      const frames = await this.frameExtractor.extract(videoPath, framesDir, analysisId, (detail) => {
        onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 50, detail });
      });

      this.db.insertFrames(frames);
      this.db.setAnalysisFramesDir(analysisId, framesDir, frames.length);
      onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 100, detail: `Extracted ${frames.length} frames` });

      // Check pause between phases
      if (this.checkPause(analysisId, 0, onProgress)) return;

      // Phase 2.5: Compute visual diffs
      this.checkAbort(ac);
      onProgress({ analysisId, status: 'analyzing', phase: 'Computing visual diffs', percent: 0, detail: 'Starting visual diff computation...' });

      const analysis = this.db.getAnalysis(analysisId);
      const videoDuration = analysis?.duration || 0;
      const diffs = await this.frameDiff.computeAllPairs(frames, videoDuration, (detail) => {
        onProgress({ analysisId, status: 'analyzing', phase: 'Computing visual diffs', percent: 25, detail });
      });

      // Phase 3: Analyze frame pairs (with pre-filter + shortcut cache)
      this.checkAbort(ac);
      this.db.updateAnalysisStatus(analysisId, 'analyzing');
      onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: 0, detail: 'Starting AI analysis...' });

      const videoTitle = analysis?.title || '';
      const detectedDescriptions: string[] = [];
      const recentEffects: Array<{ category: string }> = [];
      let effectIndex = 0;
      let failedPairs = 0;
      let lastError = '';
      let preFilterSkipped = 0;
      let shortcutResolved = 0;
      let sentToClaude = 0;

      // Check API key before starting analysis
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key not configured. Set it in Settings → API Keys.');
      }

      for (let i = 0; i < frames.length - 1; i++) {
        this.checkAbort(ac);

        // Check pause flag
        if (this.pauseFlags.get(analysisId)) {
          this.pauseFlags.delete(analysisId);
          this.db.pauseAnalysis(analysisId, i);
          onProgress({ analysisId, status: 'paused', phase: 'Paused', percent: Math.round((i / (frames.length - 1)) * 90), detail: `Paused at frame ${i + 1}/${frames.length}` });
          this.abortControllers.delete(analysisId);
          return;
        }

        const pct = Math.round((i / (frames.length - 1)) * 90);
        onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: pct, detail: `Analyzing pair ${i + 1}/${frames.length - 1}` });

        const frameBefore = frames[i];
        const frameAfter = frames[i + 1];
        const diff = diffs[i];

        // 1. Pre-filter: skip nearly identical frames
        if (diff && diff.shouldSkip) {
          preFilterSkipped++;
          continue;
        }

        // 2. Shortcut cache: try local prediction
        if (diff && this.shortcutCache.isReady()) {
          const features = this.frameDiff.extractFeatures(diff, frameBefore, frameAfter, videoDuration, recentEffects);
          const featureVector = this.frameDiff.featuresToVector(features);
          const prediction = this.shortcutCache.predict(featureVector);

          if (this.shortcutCache.shouldUseLocalPrediction(prediction) && prediction.category !== 'no-effect') {
            shortcutResolved++;
            const detected: DetectedEffect = {
              id: randomUUID(),
              analysisId,
              effectIndex: effectIndex++,
              startTime: frameBefore.timestamp,
              endTime: frameAfter.timestamp,
              category: prediction.category as DetectedEffect['category'],
              secondaryCategories: [],
              description: `Locally predicted ${prediction.category} (confidence: ${(prediction.confidence * 100).toFixed(0)}%)`,
              confidence: 'high',
              frameBefore: frameBefore.filePath,
              frameAfter: frameAfter.filePath,
              premiereRecreation: { steps: [], suggestedEffects: [], estimatedParameters: {}, notes: 'Predicted by local shortcut model' },
              rating: null,
              correctionNote: '',
              sourceIdentification: '',
              savedPresetId: null,
              source: 'local',
            };
            this.db.insertEffect(detected);
            detectedDescriptions.push(`${prediction.category}: ${detected.description}`);
            recentEffects.push({ category: prediction.category });
            continue;
          }
        }

        // 3. Send to Claude (existing path)
        sentToClaude++;
        try {
          const result = await this.vision.analyzeFramePair(
            frameBefore.filePath,
            frameAfter.filePath,
            { videoTitle, timestamp: frameBefore.timestamp, previousEffects: detectedDescriptions.slice(-5), skipCuts: options?.skipCuts },
          );

          if (result.effects.length === 0) {
            // Record as no-effect pair for training
            this.db.insertNoEffectPair(analysisId, frameBefore.filePath, frameAfter.filePath, frameBefore.timestamp, frameAfter.timestamp);
          }

          for (const effect of result.effects) {
            const detected: DetectedEffect = {
              id: randomUUID(),
              analysisId,
              effectIndex: effectIndex++,
              startTime: frameBefore.timestamp,
              endTime: frameAfter.timestamp,
              category: effect.category,
              secondaryCategories: effect.secondaryCategories,
              description: effect.description,
              confidence: effect.confidence,
              frameBefore: frameBefore.filePath,
              frameAfter: frameAfter.filePath,
              premiereRecreation: effect.premiereRecreation,
              rating: null,
              correctionNote: '',
              sourceIdentification: '',
              savedPresetId: null,
              source: 'ai',
            };
            this.db.insertEffect(detected);
            detectedDescriptions.push(`${effect.category}: ${effect.description}`);
            recentEffects.push({ category: effect.category });
          }
        } catch (err) {
          failedPairs++;
          lastError = (err as Error).message || String(err);
          console.error(`[Pipeline] Frame pair ${i} analysis failed:`, lastError);
          // If all pairs are failing (first 3 in a row), abort early — likely an API issue
          if (failedPairs >= 3 && effectIndex === 0) {
            throw new Error(`AI analysis failing: ${lastError}`);
          }
        }
      }

      console.log(`[Pipeline] Pre-filter skipped: ${preFilterSkipped}, Shortcut resolved: ${shortcutResolved}, Sent to Claude: ${sentToClaude}`);

      if (failedPairs > 0) {
        console.warn(`[Pipeline] ${failedPairs}/${frames.length - 1} frame pairs failed. Last error: ${lastError}`);
      }

      // Style analysis
      this.checkAbort(ac);
      onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: 95, detail: 'Analyzing overall style...' });

      const sampleFrames = this.pickSampleFrames(frames, 6);
      const videoInfo = analysis ? {
        videoId: analysis.videoId,
        url: analysis.url,
        title: analysis.title,
        channel: analysis.channel,
        duration: analysis.duration,
        thumbnailUrl: analysis.thumbnailUrl,
        uploadDate: analysis.uploadDate,
        description: analysis.description,
        resolution: analysis.resolution,
        fps: analysis.fps,
      } : { videoId: '', url, title: videoTitle, channel: '', duration: 0, thumbnailUrl: '', uploadDate: '', description: '', resolution: '', fps: 30 };

      let summary = '';
      let styleNotes = '';
      try {
        const style = await this.vision.analyzeOverallStyle(
          sampleFrames.map(f => f.filePath),
          videoInfo,
        );
        summary = style.summary;
        styleNotes = style.styleNotes;
      } catch (err) {
        console.error('[Pipeline] Style analysis failed:', err);
      }

      // Complete
      const elapsed = Date.now() - startTime;
      this.db.completeAnalysis(analysisId, summary, styleNotes, elapsed);
      onProgress({ analysisId, status: 'complete', phase: 'Complete', percent: 100, detail: `Found ${effectIndex} effects in ${(elapsed / 1000).toFixed(0)}s` });
    } catch (err) {
      if ((err as Error).message === 'CANCELLED') {
        this.db.updateAnalysisStatus(analysisId, 'cancelled');
        onProgress({ analysisId, status: 'cancelled', phase: 'Cancelled', percent: 0, detail: 'Analysis cancelled' });
      } else {
        const msg = (err as Error).message || 'Unknown error';
        this.db.updateAnalysisStatus(analysisId, 'error', msg);
        onProgress({ analysisId, status: 'error', phase: 'Error', percent: 0, detail: msg });
      }
    } finally {
      this.abortControllers.delete(analysisId);
      this.progressCallbacks.delete(analysisId);
    }
  }

  cancel(analysisId: string): void {
    const ac = this.abortControllers.get(analysisId);
    if (ac) ac.abort();
  }

  pause(analysisId: string): void {
    if (this.abortControllers.has(analysisId)) {
      this.pauseFlags.set(analysisId, true);
      // Emit immediate "Pausing..." feedback so the UI responds instantly
      const cb = this.progressCallbacks.get(analysisId);
      if (cb) {
        cb({ analysisId, status: 'analyzing', phase: 'Pausing...', percent: 0, detail: 'Pausing after current operation...' });
      }
    }
  }

  async resume(
    analysisId: string,
    url: string,
    onProgress: ProgressCallback,
    options?: AnalysisOptions,
  ): Promise<void> {
    const pauseIndex = this.db.getPauseFrameIndex(analysisId);
    if (pauseIndex == null) {
      throw new Error('No pause checkpoint found for this analysis');
    }

    const ac = new AbortController();
    this.abortControllers.set(analysisId, ac);
    this.progressCallbacks.set(analysisId, onProgress);
    const startTime = Date.now();

    try {
      // Load existing frames from DB
      const frames = this.db.getFrames(analysisId);
      if (frames.length < 2) throw new Error('Not enough frames to resume');

      const analysis = this.db.getAnalysis(analysisId);
      const videoDuration = analysis?.duration || 0;
      const videoTitle = analysis?.title || '';

      // Update status to analyzing
      this.db.updateAnalysisStatus(analysisId, 'analyzing');
      onProgress({ analysisId, status: 'analyzing', phase: 'Resuming analysis', percent: 0, detail: 'Recomputing visual diffs...' });

      // Recompute diffs (fast, no API calls)
      this.checkAbort(ac);
      const diffs = await this.frameDiff.computeAllPairs(frames, videoDuration, (detail) => {
        onProgress({ analysisId, status: 'analyzing', phase: 'Computing visual diffs', percent: 5, detail });
      });

      // Rebuild detectedDescriptions from existing effects in DB
      const existingEffects = this.db.getEffects(analysisId);
      const detectedDescriptions: string[] = existingEffects.map(e => `${e.category}: ${e.description}`);
      const recentEffects: Array<{ category: string }> = existingEffects.map(e => ({ category: e.category }));
      let effectIndex = existingEffects.length;
      let failedPairs = 0;
      let lastError = '';
      let preFilterSkipped = 0;
      let shortcutResolved = 0;
      let sentToClaude = 0;

      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key not configured. Set it in Settings → API Keys.');
      }

      const resumeFrom = pauseIndex;
      const totalPairs = frames.length - 1;

      onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: 10, detail: `Resuming from frame ${resumeFrom + 1}/${totalPairs}` });

      for (let i = resumeFrom; i < totalPairs; i++) {
        this.checkAbort(ac);

        // Check pause flag
        if (this.pauseFlags.get(analysisId)) {
          this.pauseFlags.delete(analysisId);
          this.db.pauseAnalysis(analysisId, i);
          onProgress({ analysisId, status: 'paused', phase: 'Paused', percent: Math.round(((i - resumeFrom) / (totalPairs - resumeFrom)) * 90) + 10, detail: `Paused at frame ${i + 1}/${totalPairs}` });
          this.abortControllers.delete(analysisId);
          return;
        }

        const pct = Math.round(((i - resumeFrom) / (totalPairs - resumeFrom)) * 80) + 10;
        onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: pct, detail: `Analyzing pair ${i + 1}/${totalPairs}` });

        const frameBefore = frames[i];
        const frameAfter = frames[i + 1];
        const diff = diffs[i];

        // 1. Pre-filter
        if (diff && diff.shouldSkip) {
          preFilterSkipped++;
          continue;
        }

        // 2. Shortcut cache
        if (diff && this.shortcutCache.isReady()) {
          const features = this.frameDiff.extractFeatures(diff, frameBefore, frameAfter, videoDuration, recentEffects);
          const featureVector = this.frameDiff.featuresToVector(features);
          const prediction = this.shortcutCache.predict(featureVector);

          if (this.shortcutCache.shouldUseLocalPrediction(prediction) && prediction.category !== 'no-effect') {
            shortcutResolved++;
            const detected: DetectedEffect = {
              id: randomUUID(),
              analysisId,
              effectIndex: effectIndex++,
              startTime: frameBefore.timestamp,
              endTime: frameAfter.timestamp,
              category: prediction.category as DetectedEffect['category'],
              secondaryCategories: [],
              description: `Locally predicted ${prediction.category} (confidence: ${(prediction.confidence * 100).toFixed(0)}%)`,
              confidence: 'high',
              frameBefore: frameBefore.filePath,
              frameAfter: frameAfter.filePath,
              premiereRecreation: { steps: [], suggestedEffects: [], estimatedParameters: {}, notes: 'Predicted by local shortcut model' },
              rating: null,
              correctionNote: '',
              sourceIdentification: '',
              savedPresetId: null,
              source: 'local',
            };
            this.db.insertEffect(detected);
            detectedDescriptions.push(`${prediction.category}: ${detected.description}`);
            recentEffects.push({ category: prediction.category });
            continue;
          }
        }

        // 3. Send to Claude
        sentToClaude++;
        try {
          const result = await this.vision.analyzeFramePair(
            frameBefore.filePath,
            frameAfter.filePath,
            { videoTitle, timestamp: frameBefore.timestamp, previousEffects: detectedDescriptions.slice(-5), skipCuts: options?.skipCuts },
          );

          if (result.effects.length === 0) {
            this.db.insertNoEffectPair(analysisId, frameBefore.filePath, frameAfter.filePath, frameBefore.timestamp, frameAfter.timestamp);
          }

          for (const effect of result.effects) {
            const detected: DetectedEffect = {
              id: randomUUID(),
              analysisId,
              effectIndex: effectIndex++,
              startTime: frameBefore.timestamp,
              endTime: frameAfter.timestamp,
              category: effect.category,
              secondaryCategories: effect.secondaryCategories,
              description: effect.description,
              confidence: effect.confidence,
              frameBefore: frameBefore.filePath,
              frameAfter: frameAfter.filePath,
              premiereRecreation: effect.premiereRecreation,
              rating: null,
              correctionNote: '',
              sourceIdentification: '',
              savedPresetId: null,
              source: 'ai',
            };
            this.db.insertEffect(detected);
            detectedDescriptions.push(`${effect.category}: ${effect.description}`);
            recentEffects.push({ category: effect.category });
          }
        } catch (err) {
          failedPairs++;
          lastError = (err as Error).message || String(err);
          console.error(`[Pipeline] Frame pair ${i} analysis failed:`, lastError);
          if (failedPairs >= 3 && effectIndex === existingEffects.length) {
            throw new Error(`AI analysis failing: ${lastError}`);
          }
        }
      }

      console.log(`[Pipeline:resume] Pre-filter skipped: ${preFilterSkipped}, Shortcut resolved: ${shortcutResolved}, Sent to Claude: ${sentToClaude}`);

      if (failedPairs > 0) {
        console.warn(`[Pipeline:resume] ${failedPairs} frame pairs failed. Last error: ${lastError}`);
      }

      // Style analysis
      this.checkAbort(ac);
      onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: 95, detail: 'Analyzing overall style...' });

      const sampleFrames = this.pickSampleFrames(frames, 6);
      const videoInfo = analysis ? {
        videoId: analysis.videoId,
        url: analysis.url,
        title: analysis.title,
        channel: analysis.channel,
        duration: analysis.duration,
        thumbnailUrl: analysis.thumbnailUrl,
        uploadDate: analysis.uploadDate,
        description: analysis.description,
        resolution: analysis.resolution,
        fps: analysis.fps,
      } : { videoId: '', url, title: videoTitle, channel: '', duration: 0, thumbnailUrl: '', uploadDate: '', description: '', resolution: '', fps: 30 };

      let summary = '';
      let styleNotes = '';
      try {
        const style = await this.vision.analyzeOverallStyle(
          sampleFrames.map(f => f.filePath),
          videoInfo,
        );
        summary = style.summary;
        styleNotes = style.styleNotes;
      } catch (err) {
        console.error('[Pipeline:resume] Style analysis failed:', err);
      }

      // Complete
      const elapsed = Date.now() - startTime;
      this.db.completeAnalysis(analysisId, summary, styleNotes, elapsed);
      onProgress({ analysisId, status: 'complete', phase: 'Complete', percent: 100, detail: `Found ${effectIndex} effects` });
    } catch (err) {
      if ((err as Error).message === 'CANCELLED') {
        this.db.updateAnalysisStatus(analysisId, 'cancelled');
        onProgress({ analysisId, status: 'cancelled', phase: 'Cancelled', percent: 0, detail: 'Analysis cancelled' });
      } else {
        const msg = (err as Error).message || 'Unknown error';
        this.db.updateAnalysisStatus(analysisId, 'error', msg);
        onProgress({ analysisId, status: 'error', phase: 'Error', percent: 0, detail: msg });
      }
    } finally {
      this.abortControllers.delete(analysisId);
      this.progressCallbacks.delete(analysisId);
    }
  }

  isRunning(analysisId: string): boolean {
    return this.abortControllers.has(analysisId);
  }

  get activeCount(): number {
    return this.abortControllers.size;
  }

  private checkAbort(ac: AbortController): void {
    if (ac.signal.aborted) throw new Error('CANCELLED');
  }

  /** Returns true if paused (caller should return early) */
  private checkPause(analysisId: string, frameIndex: number, onProgress: ProgressCallback): boolean {
    if (this.pauseFlags.get(analysisId)) {
      this.pauseFlags.delete(analysisId);
      this.db.pauseAnalysis(analysisId, frameIndex);
      onProgress({ analysisId, status: 'paused', phase: 'Paused', percent: 0, detail: `Paused at frame ${frameIndex}` });
      this.abortControllers.delete(analysisId);
      this.progressCallbacks.delete(analysisId);
      return true;
    }
    return false;
  }

  private pickSampleFrames(frames: ExtractedFrame[], count: number): ExtractedFrame[] {
    if (frames.length <= count) return frames;
    const step = Math.floor(frames.length / count);
    const samples: ExtractedFrame[] = [];
    for (let i = 0; i < count; i++) {
      samples.push(frames[Math.min(i * step, frames.length - 1)]);
    }
    return samples;
  }
}
