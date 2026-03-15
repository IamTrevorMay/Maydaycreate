import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { AnalysisProgress, DetectedEffect, ExtractedFrame } from '@mayday/types';
import { YouTubeDB } from './youtube-db.js';
import { YtDlpService } from './ytdlp-service.js';
import { FrameExtractor } from './frame-extractor.js';
import { VisionAnalyzer } from './vision-analyzer.js';

type ProgressCallback = (progress: AnalysisProgress) => void;

export class AnalysisPipeline {
  private db: YouTubeDB;
  private ytdlp: YtDlpService;
  private frameExtractor: FrameExtractor;
  private vision: VisionAnalyzer;
  private abortControllers = new Map<string, AbortController>();

  constructor(db: YouTubeDB) {
    this.db = db;
    this.ytdlp = new YtDlpService();
    this.frameExtractor = new FrameExtractor();
    this.vision = new VisionAnalyzer();
  }

  async run(
    analysisId: string,
    url: string,
    onProgress: ProgressCallback,
  ): Promise<void> {
    const ac = new AbortController();
    this.abortControllers.set(analysisId, ac);
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

      // Phase 3: Analyze frame pairs
      this.checkAbort(ac);
      this.db.updateAnalysisStatus(analysisId, 'analyzing');
      onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: 0, detail: 'Starting AI analysis...' });

      const analysis = this.db.getAnalysis(analysisId);
      const videoTitle = analysis?.title || '';
      const detectedDescriptions: string[] = [];
      let effectIndex = 0;
      let failedPairs = 0;
      let lastError = '';

      // Check API key before starting analysis
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('Anthropic API key not configured. Set it in Settings → API Keys.');
      }

      for (let i = 0; i < frames.length - 1; i++) {
        this.checkAbort(ac);
        const pct = Math.round((i / (frames.length - 1)) * 90);
        onProgress({ analysisId, status: 'analyzing', phase: 'Analyzing effects', percent: pct, detail: `Analyzing pair ${i + 1}/${frames.length - 1}` });

        const frameBefore = frames[i];
        const frameAfter = frames[i + 1];

        try {
          const result = await this.vision.analyzeFramePair(
            frameBefore.filePath,
            frameAfter.filePath,
            { videoTitle, timestamp: frameBefore.timestamp, previousEffects: detectedDescriptions.slice(-5) },
          );

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
            };
            this.db.insertEffect(detected);
            detectedDescriptions.push(`${effect.category}: ${effect.description}`);
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
    }
  }

  cancel(analysisId: string): void {
    const ac = this.abortControllers.get(analysisId);
    if (ac) ac.abort();
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
