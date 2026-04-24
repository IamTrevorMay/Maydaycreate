import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

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
      await execFileAsync(this.whisperPath, ['--help']);
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
      await execFileAsync('ffmpeg', [
        '-i', inputPath,
        '-ar', '16000',
        '-ac', '1',
        '-f', 'wav',
        '-y',
        wavPath,
      ]);

      // Run whisper
      const { stdout } = await execFileAsync(this.whisperPath, [
        '-m', this.modelPath,
        '-f', wavPath,
        '--no-timestamps',
        '-l', 'en',
      ], { timeout: 30000 });

      return stdout.trim();
    } finally {
      // Clean up temp files
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(wavPath); } catch {}
    }
  }
}
