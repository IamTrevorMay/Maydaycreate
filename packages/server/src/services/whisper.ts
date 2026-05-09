import fs from 'fs';
import path from 'path';
import os from 'os';
import { trackedExecFile } from './tracked-exec.js';
import type { TranscriptionResult, TranscriptSegment } from '@mayday/types';

export class WhisperService {
  private whisperPath: string;
  private modelPath: string;
  private available: boolean = false;

  constructor(dataDir: string) {
    this.whisperPath = process.env.WHISPER_PATH || 'whisper-cli';
    this.modelPath = path.join(dataDir, 'models', 'ggml-base.en.bin');
    this.checkAvailability();
  }

  private async checkAvailability() {
    try {
      await trackedExecFile(this.whisperPath, ['--help'], { timeout: 5_000 });
      if (fs.existsSync(this.modelPath)) {
        this.available = true;
        console.log('[Whisper] Service available');
      } else {
        console.warn(`[Whisper] Model not found at ${this.modelPath}`);
      }
    } catch {
      console.warn('[Whisper] whisper-cpp not found on PATH. Voice transcription disabled.');
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  async transcribe(audioBase64: string, mimeType: string): Promise<string> {
    if (!this.available) {
      throw new Error('Whisper service not available');
    }

    const tmpDir = os.tmpdir();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inputPath = path.join(tmpDir, `mayday-voice-${uid}.${mimeType.includes('webm') ? 'webm' : 'mp4'}`);
    const wavPath = path.join(tmpDir, `mayday-voice-${uid}.wav`);

    try {
      // Write audio to temp file
      fs.writeFileSync(inputPath, Buffer.from(audioBase64, 'base64'));

      // Convert to WAV 16kHz mono via ffmpeg
      await trackedExecFile('ffmpeg', [
        '-i', inputPath,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y',
        wavPath,
      ], { timeout: 30_000 });

      // Run whisper
      const { stdout } = await trackedExecFile(this.whisperPath, [
        '-m', this.modelPath,
        '-f', wavPath,
        '--no-timestamps',
        '-l', 'en',
      ], { timeout: 30_000 });

      return stdout.trim();
    } finally {
      // Clean up temp files
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }

  /**
   * Transcribe a file from disk into time-aligned segments.
   * Uses whisper.cpp's `--output-json` to capture per-segment timestamps,
   * then parses the resulting `<wav>.json` sidecar.
   */
  async transcribeFile(filePath: string, language: string = 'en'): Promise<TranscriptionResult> {
    if (!this.available) {
      throw new Error('Whisper service not available — install whisper-cli on PATH and place ggml-base.en.bin in the model dir.');
    }
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const tmpDir = os.tmpdir();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const wavPath = path.join(tmpDir, `mayday-transcribe-${uid}.wav`);
    const jsonSidecar = `${wavPath}.json`;

    try {
      // 1. Convert input to whisper-friendly WAV (16kHz mono PCM)
      await trackedExecFile('ffmpeg', [
        '-i', filePath,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y',
        wavPath,
      ], { timeout: 300_000, maxBuffer: 10 * 1024 * 1024 });

      // 2. Run whisper with JSON output (writes <wavPath>.json)
      await trackedExecFile(this.whisperPath, [
        '-m', this.modelPath,
        '-f', wavPath,
        '-l', language,
        '--output-json',
      ], { timeout: 600_000, maxBuffer: 50 * 1024 * 1024 });

      if (!fs.existsSync(jsonSidecar)) {
        throw new Error('Whisper produced no JSON output — expected ' + jsonSidecar);
      }

      const raw = JSON.parse(fs.readFileSync(jsonSidecar, 'utf-8')) as {
        transcription?: Array<{ timestamps?: { from?: string; to?: string }; offsets?: { from: number; to: number }; text: string }>;
        result?: { language?: string };
      };

      const segments: TranscriptSegment[] = (raw.transcription ?? []).map((seg) => {
        // Prefer offsets (milliseconds) for precision; fall back to timestamp strings.
        if (seg.offsets) {
          return {
            start: seg.offsets.from / 1000,
            end: seg.offsets.to / 1000,
            text: seg.text.trim(),
          };
        }
        return {
          start: parseTimestamp(seg.timestamps?.from ?? '00:00:00.000'),
          end: parseTimestamp(seg.timestamps?.to ?? '00:00:00.000'),
          text: seg.text.trim(),
        };
      }).filter((s) => s.text.length > 0);

      return {
        segments,
        language: raw.result?.language ?? language,
        fullText: segments.map((s) => s.text).join(' ').trim(),
      };
    } finally {
      try { fs.unlinkSync(wavPath); } catch {}
      try { fs.unlinkSync(jsonSidecar); } catch {}
    }
  }
}

/** Parse whisper.cpp timestamp string "HH:MM:SS.mmm" → seconds. */
function parseTimestamp(s: string): number {
  const m = s.match(/^(\d{2}):(\d{2}):(\d{2})[.,](\d{3})$/);
  if (!m) return 0;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
}
