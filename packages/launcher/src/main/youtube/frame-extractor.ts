import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import type { ExtractedFrame } from '@mayday/types';

const SCENE_THRESHOLD = 0.3;
const GAP_FILL_INTERVAL_HIGH = 0.5;    // high scene density > 0.5 scenes/sec
const GAP_FILL_INTERVAL_DEFAULT = 1;   // normal density
const GAP_FILL_INTERVAL_LOW = 2;       // low scene density < 0.1 scenes/sec
const MAX_GAP_SECONDS = 3;
const FRAME_WIDTH = 1280;
const THUMB_WIDTH = 320;

function ffmpegPath(): string {
  // Use system ffmpeg — assume it's on PATH
  return 'ffmpeg';
}

function ffprobePath(): string {
  return 'ffprobe';
}

function execAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} failed: ${err.message}\n${stderr}`));
        return;
      }
      resolve(stdout + stderr);
    });
  });
}

interface SceneFrame {
  timestamp: number;
  score: number;
}

export class FrameExtractor {
  async extract(
    videoPath: string,
    outputDir: string,
    analysisId: string,
    onProgress?: (detail: string) => void,
  ): Promise<ExtractedFrame[]> {
    const framesDir = path.join(outputDir, 'frames');
    const thumbsDir = path.join(outputDir, 'thumbs');
    fs.mkdirSync(framesDir, { recursive: true });
    fs.mkdirSync(thumbsDir, { recursive: true });

    // Get video duration
    const duration = await this.getVideoDuration(videoPath);

    // Pass 1: Scene detection
    onProgress?.('Detecting scene changes...');
    const sceneFrames = await this.detectScenes(videoPath);

    // Pass 2: Fill gaps with interval frames
    onProgress?.('Extracting gap-fill frames...');
    const allTimestamps = this.fillGaps(sceneFrames, duration);

    // Extract actual frames
    const frames: ExtractedFrame[] = [];
    for (let i = 0; i < allTimestamps.length; i++) {
      const { timestamp, score, method } = allTimestamps[i];
      onProgress?.(`Extracting frame ${i + 1}/${allTimestamps.length}`);

      const frameId = randomUUID();
      const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
      const thumbPath = path.join(thumbsDir, `thumb_${String(i).padStart(5, '0')}.png`);

      await this.extractFrame(videoPath, timestamp, framePath, FRAME_WIDTH);
      await this.extractFrame(videoPath, timestamp, thumbPath, THUMB_WIDTH);

      frames.push({
        id: frameId,
        analysisId,
        frameIndex: i,
        timestamp,
        filePath: framePath,
        thumbnailPath: thumbPath,
        method,
        sceneScore: score,
      });
    }

    return frames;
  }

  private async getVideoDuration(videoPath: string): Promise<number> {
    const output = await execAsync(ffprobePath(), [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    return parseFloat(output.trim()) || 0;
  }

  private async detectScenes(videoPath: string): Promise<SceneFrame[]> {
    const output = await execAsync(ffmpegPath(), [
      '-i', videoPath,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-vsync', 'vfr',
      '-f', 'null',
      '-',
    ]);

    const scenes: SceneFrame[] = [];
    // Parse showinfo output for timestamps
    const lines = output.split('\n');
    for (const line of lines) {
      const ptsMatch = line.match(/pts_time:([\d.]+)/);
      const sceneMatch = line.match(/scene:([\d.]+)/);
      if (ptsMatch) {
        scenes.push({
          timestamp: parseFloat(ptsMatch[1]),
          score: sceneMatch ? parseFloat(sceneMatch[1]) : SCENE_THRESHOLD,
        });
      }
    }

    // Always include frame 0
    if (scenes.length === 0 || scenes[0].timestamp > 0.5) {
      scenes.unshift({ timestamp: 0, score: 1.0 });
    }

    return scenes.sort((a, b) => a.timestamp - b.timestamp);
  }

  private computeSceneDensity(sceneFrames: SceneFrame[], centerTime: number): number {
    const windowHalf = 5; // 10s rolling window
    const windowStart = Math.max(0, centerTime - windowHalf);
    const windowEnd = centerTime + windowHalf;
    const windowDuration = windowEnd - windowStart;
    if (windowDuration <= 0) return 0;

    const count = sceneFrames.filter(sf => sf.timestamp >= windowStart && sf.timestamp <= windowEnd).length;
    return count / windowDuration;
  }

  private fillGaps(
    sceneFrames: SceneFrame[],
    duration: number,
  ): Array<{ timestamp: number; score: number | null; method: 'scene-detect' | 'interval' }> {
    const result: Array<{ timestamp: number; score: number | null; method: 'scene-detect' | 'interval' }> = [];

    // Add all scene frames
    for (const sf of sceneFrames) {
      result.push({ timestamp: sf.timestamp, score: sf.score, method: 'scene-detect' });
    }

    // Fill gaps > MAX_GAP_SECONDS with adaptive intervals
    const timestamps = sceneFrames.map(f => f.timestamp);
    timestamps.push(duration); // add end

    for (let i = 0; i < timestamps.length - 1; i++) {
      const start = timestamps[i];
      const end = timestamps[i + 1];
      const gap = end - start;

      if (gap > MAX_GAP_SECONDS) {
        const midpoint = (start + end) / 2;
        const density = this.computeSceneDensity(sceneFrames, midpoint);

        let interval: number;
        if (density > 0.5) {
          interval = GAP_FILL_INTERVAL_HIGH;
        } else if (density < 0.1) {
          interval = GAP_FILL_INTERVAL_LOW;
        } else {
          interval = GAP_FILL_INTERVAL_DEFAULT;
        }

        const fillCount = Math.floor(gap / interval) - 1;
        for (let j = 1; j <= fillCount && j * interval + start < end; j++) {
          result.push({
            timestamp: start + j * interval,
            score: null,
            method: 'interval',
          });
        }
      }
    }

    return result.sort((a, b) => a.timestamp - b.timestamp);
  }

  private async extractFrame(
    videoPath: string,
    timestamp: number,
    outputPath: string,
    width: number,
  ): Promise<void> {
    await execAsync(ffmpegPath(), [
      '-ss', String(timestamp),
      '-i', videoPath,
      '-vframes', '1',
      '-vf', `scale=${width}:-1`,
      '-y',
      outputPath,
    ]);
  }
}
