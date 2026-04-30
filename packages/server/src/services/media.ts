import type { MediaMetadata, MediaStream as MStream, SilentRegion } from '@mayday/types';
import { trackedExecFile } from './tracked-exec.js';

function parseFrameRate(str: string): number {
  if (!str) return 0;
  const parts = str.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den !== 0 ? num / den : 0;
  }
  return parseFloat(str) || 0;
}

export class MediaService {
  async getMetadata(filePath: string): Promise<MediaMetadata> {
    const { stdout } = await trackedExecFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath,
    ], { timeout: 15_000 });

    const data = JSON.parse(stdout);
    const streams: MStream[] = (data.streams || []).map((s: Record<string, unknown>, i: number) => {
      const type = s.codec_type === 'video' ? 'video'
        : s.codec_type === 'audio' ? 'audio'
        : s.codec_type === 'subtitle' ? 'subtitle' : 'data';

      return {
        index: i,
        type,
        codec: s.codec_name as string,
        codecLong: s.codec_long_name as string,
        ...(type === 'video' ? {
          width: s.width as number,
          height: s.height as number,
          frameRate: parseFrameRate(s.r_frame_rate as string),
          pixelFormat: s.pix_fmt as string,
        } : {}),
        ...(type === 'audio' ? {
          sampleRate: parseInt(s.sample_rate as string, 10),
          channels: s.channels as number,
          channelLayout: s.channel_layout as string,
          bitRate: parseInt(s.bit_rate as string, 10),
        } : {}),
      };
    });

    return {
      filePath,
      format: data.format?.format_name || 'unknown',
      duration: parseFloat(data.format?.duration || '0'),
      size: parseInt(data.format?.size || '0', 10),
      bitRate: parseInt(data.format?.bit_rate || '0', 10),
      streams,
    };
  }

  async detectSilence(filePath: string, options?: { threshold?: number; minDuration?: number }): Promise<SilentRegion[]> {
    const threshold = options?.threshold ?? -30;
    const minDuration = options?.minDuration ?? 0.5;

    try {
      const { stderr } = await trackedExecFile('ffmpeg', [
        '-i', filePath,
        '-af', `silencedetect=noise=${threshold}dB:d=${minDuration}`,
        '-f', 'null', '-',
      ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

      const regions: SilentRegion[] = [];
      const lines = stderr.split('\n');
      let currentStart: number | null = null;

      for (const line of lines) {
        const startMatch = line.match(/silence_start:\s*([\d.]+)/);
        const endMatch = line.match(/silence_end:\s*([\d.]+)/);

        if (startMatch) {
          currentStart = parseFloat(startMatch[1]);
        }
        if (endMatch && currentStart !== null) {
          const end = parseFloat(endMatch[1]);
          regions.push({
            start: currentStart,
            end,
            duration: end - currentStart,
          });
          currentStart = null;
        }
      }

      return regions;
    } catch (err: unknown) {
      // ffmpeg returns non-zero on some valid runs, check stderr for silence data
      const error = err as { stderr?: string };
      if (error.stderr?.includes('silence_start')) {
        const regions: SilentRegion[] = [];
        const lines = error.stderr.split('\n');
        let currentStart: number | null = null;

        for (const line of lines) {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/);
          const endMatch = line.match(/silence_end:\s*([\d.]+)/);

          if (startMatch) {
            currentStart = parseFloat(startMatch[1]);
          }
          if (endMatch && currentStart !== null) {
            const end = parseFloat(endMatch[1]);
            regions.push({
              start: currentStart,
              end,
              duration: end - currentStart,
            });
            currentStart = null;
          }
        }

        return regions;
      }
      throw err;
    }
  }

  /**
   * Get RMS audio levels at regular intervals across the file.
   * Returns an array of { time, rms } where rms is 0-1 normalized.
   */
  async getAudioLevels(filePath: string, intervalSeconds = 0.5): Promise<Array<{ time: number; rms: number }>> {
    try {
      // Use ffmpeg's astats filter to compute RMS levels per segment
      const { stderr } = await trackedExecFile('ffmpeg', [
        '-i', filePath,
        '-af', `asegment=segment_time=${intervalSeconds},astats=metadata=1:reset=1`,
        '-f', 'null', '-',
      ], { timeout: 120_000, maxBuffer: 50 * 1024 * 1024 });

      const levels: Array<{ time: number; rms: number }> = [];
      const lines = stderr.split('\n');
      let currentTime = 0;

      for (const line of lines) {
        // Parse "lavfi.astats.Overall.RMS_level" from metadata
        const rmsMatch = line.match(/RMS_level=([-\d.]+)/);
        if (rmsMatch) {
          const rmsDb = parseFloat(rmsMatch[1]);
          // Convert dB to 0-1 scale: -60dB → 0, 0dB → 1
          const rmsNorm = Math.max(0, Math.min(1, (rmsDb + 60) / 60));
          levels.push({ time: currentTime, rms: rmsNorm });
          currentTime += intervalSeconds;
        }
      }

      return levels;
    } catch {
      return [];
    }
  }

  async getWaveform(filePath: string, options?: { samples?: number; channel?: number }): Promise<number[]> {
    const samples = options?.samples ?? 1000;
    const channel = options?.channel ?? 0;

    const { stdout } = await trackedExecFile('ffmpeg', [
      '-i', filePath,
      '-filter_complex', `[0:a]channelsplit=channel_layout=mono[ch];[ch]aformat=sample_fmts=flt:channel_layouts=mono,compand=gain=-6[out]`,
      '-map', '[out]',
      '-ac', '1',
      '-f', 'f32le',
      '-frames:a', String(samples),
      '-',
    ], { timeout: 30_000, encoding: 'buffer' as BufferEncoding, maxBuffer: samples * 4 + 1024 } as Record<string, unknown>);

    const buffer = stdout as unknown as Buffer;
    const floats: number[] = [];
    for (let i = 0; i < buffer.length - 3; i += 4) {
      floats.push(buffer.readFloatLE(i));
    }
    return floats;
  }
}
