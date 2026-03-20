import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { CutFinderProgress, DetectedCut, ExtractedFrame } from '@mayday/types';
import { CutFinderDB } from './cut-finder-db.js';
import { YtDlpService } from '../youtube/ytdlp-service.js';
import { FrameExtractor } from '../youtube/frame-extractor.js';
import { FrameDiffAnalyzer } from '../youtube/frame-diff.js';

type ProgressCallback = (progress: CutFinderProgress) => void;

/** Threshold above which a visual diff is considered a cut */
const CUT_DIFF_THRESHOLD = 0.35;

/** High confidence threshold */
const HIGH_CONFIDENCE_THRESHOLD = 0.60;

function classifyConfidence(diffScore: number): DetectedCut['confidence'] {
  if (diffScore >= HIGH_CONFIDENCE_THRESHOLD) return 'high';
  if (diffScore >= CUT_DIFF_THRESHOLD) return 'medium';
  return 'low';
}

export class CutFinderPipeline {
  private db: CutFinderDB;
  private ytdlp: YtDlpService;
  private frameExtractor: FrameExtractor;
  private frameDiff: FrameDiffAnalyzer;
  private abortControllers = new Map<string, AbortController>();
  private pauseFlags = new Map<string, boolean>();
  private progressCallbacks = new Map<string, ProgressCallback>();

  constructor(db: CutFinderDB) {
    this.db = db;
    this.ytdlp = new YtDlpService();
    this.frameExtractor = new FrameExtractor();
    this.frameDiff = new FrameDiffAnalyzer();
  }

  async run(
    analysisId: string,
    url: string,
    onProgress: ProgressCallback,
  ): Promise<void> {
    const ac = new AbortController();
    this.abortControllers.set(analysisId, ac);
    this.progressCallbacks.set(analysisId, onProgress);
    const startTime = Date.now();

    const dataDir = path.join(app.getPath('userData'), 'cut-finder', analysisId);
    fs.mkdirSync(dataDir, { recursive: true });

    try {
      // Phase 1: Download
      this.checkAbort(ac);
      this.db.updateStatus(analysisId, 'downloading');
      onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: 0, detail: 'Starting download...' });

      const videoPath = await this.ytdlp.download(url, dataDir, (percent) => {
        onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: Math.min(percent, 99), detail: `${percent.toFixed(0)}%` });
      });
      this.db.setVideoPath(analysisId, videoPath);

      // Download thumbnail
      const thumbPath = path.join(dataDir, 'thumbnail.png');
      const thumbResult = await this.ytdlp.downloadThumbnail(url, thumbPath);
      if (thumbResult) {
        this.db.setThumbnailPath(analysisId, thumbResult);
      }

      onProgress({ analysisId, status: 'downloading', phase: 'Downloading video', percent: 100, detail: 'Download complete' });

      if (this.checkPause(analysisId, 0, onProgress)) return;

      // Phase 2: Extract frames
      this.checkAbort(ac);
      this.db.updateStatus(analysisId, 'extracting');
      onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 0, detail: 'Starting frame extraction...' });

      const framesDir = path.join(dataDir, 'extracted');
      const frames = await this.frameExtractor.extract(videoPath, framesDir, analysisId, (detail) => {
        onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 50, detail });
      });

      this.db.insertFrames(frames);
      this.db.setFramesDir(analysisId, framesDir, frames.length);
      onProgress({ analysisId, status: 'extracting', phase: 'Extracting frames', percent: 100, detail: `Extracted ${frames.length} frames` });

      if (this.checkPause(analysisId, 0, onProgress)) return;

      // Phase 3: Detect cuts via visual diffs
      this.checkAbort(ac);
      this.db.updateStatus(analysisId, 'detecting');
      onProgress({ analysisId, status: 'detecting', phase: 'Detecting cuts', percent: 0, detail: 'Computing visual diffs...' });

      const analysis = this.db.getAnalysis(analysisId);
      const videoDuration = analysis?.duration || 0;
      const diffs = await this.frameDiff.computeAllPairs(frames, videoDuration, (detail) => {
        onProgress({ analysisId, status: 'detecting', phase: 'Detecting cuts', percent: 25, detail });
      });

      let cutIndex = 0;
      for (let i = 0; i < diffs.length; i++) {
        this.checkAbort(ac);

        if (this.pauseFlags.get(analysisId)) {
          this.pauseFlags.delete(analysisId);
          this.db.pauseAnalysis(analysisId, i);
          onProgress({ analysisId, status: 'paused', phase: 'Paused', percent: Math.round((i / diffs.length) * 70) + 25, detail: `Paused at frame ${i + 1}/${diffs.length}` });
          this.abortControllers.delete(analysisId);
          return;
        }

        const pct = Math.round((i / diffs.length) * 70) + 25;
        onProgress({ analysisId, status: 'detecting', phase: 'Detecting cuts', percent: pct, detail: `Analyzing pair ${i + 1}/${diffs.length}` });

        const diff = diffs[i];
        if (!diff || diff.shouldSkip) continue;

        // A cut is a high visual diff (scene change)
        if (diff.visualDiffScore >= CUT_DIFF_THRESHOLD) {
          const frameBefore = frames[i];
          const frameAfter = frames[i + 1];

          const cut: DetectedCut = {
            id: randomUUID(),
            analysisId,
            cutIndex: cutIndex++,
            timestamp: frameAfter.timestamp,
            confidence: classifyConfidence(diff.visualDiffScore),
            frameBefore: frameBefore.filePath,
            frameAfter: frameAfter.filePath,
            diffScore: diff.visualDiffScore,
          };
          this.db.insertCut(cut, analysis?.videoId);
        }
      }

      // Complete
      const elapsed = Date.now() - startTime;
      this.db.completeAnalysis(analysisId, elapsed);
      onProgress({ analysisId, status: 'complete', phase: 'Complete', percent: 100, detail: `Found ${cutIndex} cuts in ${(elapsed / 1000).toFixed(0)}s` });
    } catch (err) {
      if ((err as Error).message === 'CANCELLED') {
        this.db.updateStatus(analysisId, 'cancelled');
        onProgress({ analysisId, status: 'cancelled', phase: 'Cancelled', percent: 0, detail: 'Analysis cancelled' });
      } else {
        const msg = (err as Error).message || 'Unknown error';
        this.db.updateStatus(analysisId, 'error', msg);
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
      const cb = this.progressCallbacks.get(analysisId);
      if (cb) {
        cb({ analysisId, status: 'detecting', phase: 'Pausing...', percent: 0, detail: 'Pausing after current operation...' });
      }
    }
  }

  async resume(
    analysisId: string,
    onProgress: ProgressCallback,
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
      const frames = this.db.getFrames(analysisId);
      if (frames.length < 2) throw new Error('Not enough frames to resume');

      const analysis = this.db.getAnalysis(analysisId);
      const videoDuration = analysis?.duration || 0;

      this.db.updateStatus(analysisId, 'detecting');
      onProgress({ analysisId, status: 'detecting', phase: 'Resuming detection', percent: 0, detail: 'Recomputing visual diffs...' });

      this.checkAbort(ac);
      const diffs = await this.frameDiff.computeAllPairs(frames, videoDuration, (detail) => {
        onProgress({ analysisId, status: 'detecting', phase: 'Computing visual diffs', percent: 5, detail });
      });

      const existingCuts = this.db.getCuts(analysisId);
      let cutIndex = existingCuts.length;
      const totalPairs = diffs.length;
      const resumeFrom = pauseIndex;

      onProgress({ analysisId, status: 'detecting', phase: 'Detecting cuts', percent: 10, detail: `Resuming from frame ${resumeFrom + 1}/${totalPairs}` });

      for (let i = resumeFrom; i < totalPairs; i++) {
        this.checkAbort(ac);

        if (this.pauseFlags.get(analysisId)) {
          this.pauseFlags.delete(analysisId);
          this.db.pauseAnalysis(analysisId, i);
          onProgress({ analysisId, status: 'paused', phase: 'Paused', percent: Math.round(((i - resumeFrom) / (totalPairs - resumeFrom)) * 85) + 10, detail: `Paused at frame ${i + 1}/${totalPairs}` });
          this.abortControllers.delete(analysisId);
          return;
        }

        const pct = Math.round(((i - resumeFrom) / (totalPairs - resumeFrom)) * 85) + 10;
        onProgress({ analysisId, status: 'detecting', phase: 'Detecting cuts', percent: pct, detail: `Analyzing pair ${i + 1}/${totalPairs}` });

        const diff = diffs[i];
        if (!diff || diff.shouldSkip) continue;

        if (diff.visualDiffScore >= CUT_DIFF_THRESHOLD) {
          const frameBefore = frames[i];
          const frameAfter = frames[i + 1];

          const cut: DetectedCut = {
            id: randomUUID(),
            analysisId,
            cutIndex: cutIndex++,
            timestamp: frameAfter.timestamp,
            confidence: classifyConfidence(diff.visualDiffScore),
            frameBefore: frameBefore.filePath,
            frameAfter: frameAfter.filePath,
            diffScore: diff.visualDiffScore,
          };
          this.db.insertCut(cut, analysis?.videoId);
        }
      }

      const elapsed = Date.now() - startTime;
      this.db.completeAnalysis(analysisId, elapsed);
      onProgress({ analysisId, status: 'complete', phase: 'Complete', percent: 100, detail: `Found ${cutIndex} cuts` });
    } catch (err) {
      if ((err as Error).message === 'CANCELLED') {
        this.db.updateStatus(analysisId, 'cancelled');
        onProgress({ analysisId, status: 'cancelled', phase: 'Cancelled', percent: 0, detail: 'Analysis cancelled' });
      } else {
        const msg = (err as Error).message || 'Unknown error';
        this.db.updateStatus(analysisId, 'error', msg);
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
}
