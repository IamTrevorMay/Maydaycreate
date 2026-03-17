import { execFile } from 'child_process';
import type { ExtractedFrame } from '@mayday/types';

const PRE_FILTER_THRESHOLD = 0.05;
const LOW_LUMA_THRESHOLD = 16;
const HIGH_LUMA_THRESHOLD = 240;
const CONCURRENCY_LIMIT = 4;

function isLowComplexityPair(lumaBefore: number, lumaAfter: number): boolean {
  return (lumaBefore <= LOW_LUMA_THRESHOLD && lumaAfter <= LOW_LUMA_THRESHOLD)
    || (lumaBefore >= HIGH_LUMA_THRESHOLD && lumaAfter >= HIGH_LUMA_THRESHOLD);
}

function ffmpegPath(): string {
  return 'ffmpeg';
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

export interface FramePairDiff {
  frameBeforeIndex: number;
  frameAfterIndex: number;
  psnr: number;
  ssim: number;
  psnrNorm: number;
  lumaBefore: number;
  lumaAfter: number;
  satBefore: number;
  satAfter: number;
  chromaUBefore: number;
  chromaUAfter: number;
  chromaVBefore: number;
  chromaVAfter: number;
  lumaDelta: number;
  satDelta: number;
  chromaUDelta: number;
  chromaVDelta: number;
  visualDiffScore: number;
  shouldSkip: boolean;
}

export interface FrameDiffFeatures {
  psnrNorm: number;
  ssim: number;
  lumaDelta: number;
  satDelta: number;
  chromaUDelta: number;
  chromaVDelta: number;
  sceneScore: number;
  timeDelta: number;
  isInterval: number;
  positionInVideo: number;
  recentEffectDensity: number;
  recentTransitionFraction: number;
}

function parsePsnr(output: string): number {
  // PSNR line: [Parsed_psnr_0 @ ...] PSNR y:42.123 ...  average:40.567 ...
  const match = output.match(/PSNR.*?average:([\d.]+|inf)/i);
  if (!match) return 100; // identical frames
  if (match[1] === 'inf') return 100;
  return parseFloat(match[1]) || 0;
}

function parseSsim(output: string): number {
  // SSIM line: [Parsed_ssim_0 @ ...] SSIM ... All:0.987654 (...)
  const match = output.match(/SSIM.*?All:([\d.]+)/i);
  if (!match) return 1.0;
  return parseFloat(match[1]) || 0;
}

interface SignalStats {
  yavg: number;
  satavg: number;
  uavg: number;
  vavg: number;
}

async function getSignalStats(framePath: string): Promise<SignalStats> {
  try {
    const output = await execAsync(ffmpegPath(), [
      '-i', framePath,
      '-vf', 'signalstats',
      '-f', 'null',
      '-',
    ]);

    const yavg = parseFloat(output.match(/YAVG=([\d.]+)/)?.[1] || '128');
    const satavg = parseFloat(output.match(/SATAVG=([\d.]+)/)?.[1] || '0');
    const uavg = parseFloat(output.match(/UAVG=([\d.]+)/)?.[1] || '128');
    const vavg = parseFloat(output.match(/VAVG=([\d.]+)/)?.[1] || '128');

    return { yavg, satavg, uavg, vavg };
  } catch {
    return { yavg: 128, satavg: 0, uavg: 128, vavg: 128 };
  }
}

function normalizePsnr(psnr: number): number {
  // Normalize PSNR to [0, 1] where 100 → 1.0, 0 → 0.0
  return Math.min(psnr / 100, 1.0);
}

function computeVisualDiffScore(ssim: number, psnrNorm: number): number {
  return 1.0 - (ssim * 0.6 + psnrNorm * 0.4);
}

export class FrameDiffAnalyzer {
  async computePairDiff(
    beforePath: string,
    afterPath: string,
    beforeIndex: number,
    afterIndex: number,
  ): Promise<FramePairDiff> {
    // Run PSNR+SSIM in one ffmpeg call
    let psnr = 100;
    let ssim = 1.0;
    try {
      const output = await execAsync(ffmpegPath(), [
        '-i', beforePath,
        '-i', afterPath,
        '-lavfi', '[0:v][1:v]psnr;[0:v][1:v]ssim',
        '-f', 'null',
        '-',
      ]);
      psnr = parsePsnr(output);
      ssim = parseSsim(output);
    } catch {
      // If ffmpeg fails, assume frames are different
      psnr = 20;
      ssim = 0.5;
    }

    // Get signalstats for both frames
    const [statsBefore, statsAfter] = await Promise.all([
      getSignalStats(beforePath),
      getSignalStats(afterPath),
    ]);

    const psnrNorm = normalizePsnr(psnr);
    const lumaDelta = Math.abs(statsBefore.yavg - statsAfter.yavg) / 255;
    const satDelta = Math.abs(statsBefore.satavg - statsAfter.satavg) / 255;
    const chromaUDelta = Math.abs(statsBefore.uavg - statsAfter.uavg) / 255;
    const chromaVDelta = Math.abs(statsBefore.vavg - statsAfter.vavg) / 255;
    const visualDiffScore = computeVisualDiffScore(ssim, psnrNorm);

    return {
      frameBeforeIndex: beforeIndex,
      frameAfterIndex: afterIndex,
      psnr,
      ssim,
      psnrNorm,
      lumaBefore: statsBefore.yavg,
      lumaAfter: statsAfter.yavg,
      satBefore: statsBefore.satavg,
      satAfter: statsAfter.satavg,
      chromaUBefore: statsBefore.uavg,
      chromaUAfter: statsAfter.uavg,
      chromaVBefore: statsBefore.vavg,
      chromaVAfter: statsAfter.vavg,
      lumaDelta,
      satDelta,
      chromaUDelta,
      chromaVDelta,
      visualDiffScore,
      shouldSkip: visualDiffScore < PRE_FILTER_THRESHOLD || isLowComplexityPair(statsBefore.yavg, statsAfter.yavg),
    };
  }

  async computeAllPairs(
    frames: ExtractedFrame[],
    duration: number,
    onProgress?: (detail: string) => void,
  ): Promise<FramePairDiff[]> {
    const totalPairs = frames.length - 1;
    if (totalPairs <= 0) return [];

    const results: FramePairDiff[] = new Array(totalPairs);
    let completed = 0;

    // Process with concurrency limit
    const queue = Array.from({ length: totalPairs }, (_, i) => i);
    const workers: Promise<void>[] = [];

    for (let w = 0; w < Math.min(CONCURRENCY_LIMIT, totalPairs); w++) {
      workers.push(
        (async () => {
          while (queue.length > 0) {
            const i = queue.shift()!;
            results[i] = await this.computePairDiff(
              frames[i].filePath,
              frames[i + 1].filePath,
              i,
              i + 1,
            );
            completed++;
            onProgress?.(`Computing visual diffs: ${completed}/${totalPairs}`);
          }
        })(),
      );
    }

    await Promise.all(workers);
    return results;
  }

  extractFeatures(
    diff: FramePairDiff,
    frame: ExtractedFrame,
    nextFrame: ExtractedFrame,
    duration: number,
    recentEffects: Array<{ category: string }>,
  ): FrameDiffFeatures {
    const timeDelta = duration > 0
      ? Math.min((nextFrame.timestamp - frame.timestamp) / duration, 1)
      : 0;

    const sceneScore = frame.sceneScore ?? 0;
    const isInterval = frame.method === 'interval' ? 1 : 0;
    const positionInVideo = duration > 0 ? Math.min(frame.timestamp / duration, 1) : 0;

    const last10 = recentEffects.slice(-10);
    const recentEffectDensity = Math.min(last10.length / 10, 1);
    const recentTransitionFraction = last10.length > 0
      ? last10.filter(e => e.category === 'transition').length / last10.length
      : 0;

    return {
      psnrNorm: diff.psnrNorm,
      ssim: diff.ssim,
      lumaDelta: diff.lumaDelta,
      satDelta: diff.satDelta,
      chromaUDelta: diff.chromaUDelta,
      chromaVDelta: diff.chromaVDelta,
      sceneScore,
      timeDelta,
      isInterval,
      positionInVideo,
      recentEffectDensity,
      recentTransitionFraction,
    };
  }

  featuresToVector(features: FrameDiffFeatures): number[] {
    return [
      features.psnrNorm,
      features.ssim,
      features.lumaDelta,
      features.satDelta,
      features.chromaUDelta,
      features.chromaVDelta,
      features.sceneScore,
      features.timeDelta,
      features.isInterval,
      features.positionInVideo,
      features.recentEffectDensity,
      features.recentTransitionFraction,
    ];
  }
}

export { PRE_FILTER_THRESHOLD };
