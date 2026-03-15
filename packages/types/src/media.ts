/** Media analysis types */

export interface MediaMetadata {
  filePath: string;
  format: string;
  duration: number;
  size: number;
  streams: MediaStream[];
  bitRate: number;
}

export interface MediaStream {
  index: number;
  type: 'video' | 'audio' | 'subtitle' | 'data';
  codec: string;
  codecLong: string;
  // Video-specific
  width?: number;
  height?: number;
  frameRate?: number;
  pixelFormat?: string;
  // Audio-specific
  sampleRate?: number;
  channels?: number;
  channelLayout?: string;
  bitRate?: number;
}

export interface SilentRegion {
  start: number;
  end: number;
  duration: number;
}

export interface WaveformData {
  samples: number[];
  sampleRate: number;
  duration: number;
  channel: number;
}
