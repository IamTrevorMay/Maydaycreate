import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import type { YouTubeVideoInfo } from '@mayday/types';

// Use createRequire so rollup doesn't bundle yt-dlp-wrap
const require = createRequire(import.meta.url);

let YTDlpWrapClass: any = null;

async function getYTDlpWrap(): Promise<any> {
  if (!YTDlpWrapClass) {
    YTDlpWrapClass = require('yt-dlp-wrap');
    // Handle both CJS default and named export
    if (YTDlpWrapClass.default) YTDlpWrapClass = YTDlpWrapClass.default;
  }
  return YTDlpWrapClass;
}

function binDir(): string {
  return path.join(app.getPath('userData'), 'bin');
}

function binaryPath(): string {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(binDir(), `yt-dlp${ext}`);
}

export class YtDlpService {
  async ensureBinary(): Promise<string> {
    const binPath = binaryPath();
    if (fs.existsSync(binPath)) return binPath;

    fs.mkdirSync(binDir(), { recursive: true });
    const Wrap = await getYTDlpWrap();
    await (Wrap as any).downloadFromGithub(binPath);
    return binPath;
  }

  async getVideoInfo(url: string): Promise<YouTubeVideoInfo> {
    const binPath = await this.ensureBinary();
    const Wrap = await getYTDlpWrap();
    const ytdlp = new Wrap(binPath);

    const raw = await ytdlp.getVideoInfo(url);

    return {
      videoId: raw.id || '',
      url: raw.webpage_url || url,
      title: raw.title || 'Untitled',
      channel: raw.channel || raw.uploader || 'Unknown',
      duration: raw.duration || 0,
      thumbnailUrl: raw.thumbnail || '',
      uploadDate: raw.upload_date || '',
      description: (raw.description || '').slice(0, 2000),
      resolution: raw.resolution || `${raw.width || 0}x${raw.height || 0}`,
      fps: raw.fps || 30,
    };
  }

  async download(
    url: string,
    outputDir: string,
    onProgress?: (percent: number) => void,
  ): Promise<string> {
    const binPath = await this.ensureBinary();
    const Wrap = await getYTDlpWrap();
    const ytdlp = new Wrap(binPath);

    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'video.mp4');

    return new Promise<string>((resolve, reject) => {
      const proc = ytdlp.exec([
        url,
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        '--no-playlist',
      ]);

      proc.on('progress', (progress: { percent?: number }) => {
        if (progress.percent != null && onProgress) {
          onProgress(progress.percent);
        }
      });

      proc.on('close', () => {
        if (fs.existsSync(outputPath)) {
          resolve(outputPath);
        } else {
          reject(new Error('Download completed but output file not found'));
        }
      });

      proc.on('error', reject);
    });
  }

  async downloadThumbnail(url: string, outputPath: string): Promise<string> {
    const binPath = await this.ensureBinary();
    const Wrap = await getYTDlpWrap();
    const ytdlp = new Wrap(binPath);

    const dir = path.dirname(outputPath);
    fs.mkdirSync(dir, { recursive: true });

    return new Promise<string>((resolve, reject) => {
      const proc = ytdlp.exec([
        url,
        '--write-thumbnail',
        '--skip-download',
        '--convert-thumbnails', 'png',
        '-o', outputPath.replace(/\.png$/, ''),
        '--no-playlist',
      ]);

      proc.on('close', () => {
        // yt-dlp may append extension
        const candidates = [outputPath, outputPath.replace(/\.png$/, '.webp'), outputPath.replace(/\.png$/, '.jpg')];
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            resolve(c);
            return;
          }
        }
        resolve('');
      });

      proc.on('error', () => resolve(''));
    });
  }
}
