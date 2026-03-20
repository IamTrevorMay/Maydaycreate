/** Plugin system types */

export type PluginStatus = 'discovered' | 'loaded' | 'activated' | 'deactivated' | 'errored';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  main: string;
  commands?: PluginCommand[];
  config?: PluginConfigSchema;
  permissions?: PluginPermission[];
}

export interface PluginCommand {
  id: string;
  name: string;
  description?: string;
  icon?: string;
}

export interface PluginConfigSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'select';
    label: string;
    default: unknown;
    options?: Array<{ label: string; value: string | number }>;
    description?: string;
  };
}

export type PluginPermission = 'timeline' | 'media' | 'ai' | 'effects' | 'filesystem' | 'network';

/** Maps permission names to their corresponding PluginServices keys. */
export const PERMISSION_SERVICE_MAP: Record<string, keyof PluginServices> = {
  timeline: 'timeline',
  media: 'media',
  ai: 'ai',
  effects: 'effects',
};

export interface PluginContext {
  pluginId: string;
  services: PluginServices;
  config: Record<string, unknown>;
  log: PluginLogger;
  data: PluginDataStore;
  ui: PluginUI;
  dataDir: string;
  onEvent(eventType: string, handler: (data: unknown) => void): { unsubscribe(): void };
}

export interface PluginServices {
  timeline: TimelineServiceAPI;
  ai: AIServiceAPI;
  media: MediaServiceAPI;
  effects: import('./effects').EffectsServiceAPI;
}

export interface TimelineServiceAPI {
  getActiveSequence(): Promise<import('./timeline').Sequence | null>;
  getClips(trackIndex?: number, trackType?: 'video' | 'audio'): Promise<import('./timeline').Clip[]>;
  addMarker(time: number, name: string, color?: string, comment?: string): Promise<void>;
  getMarkers(): Promise<import('./timeline').Marker[]>;
  removeClip(clipId: string): Promise<void>;
  setClipInOutPoints(clipId: string, inPoint: number, outPoint: number): Promise<void>;
  getPlayheadPosition(): Promise<number>;
  setPlayheadPosition(time: number): Promise<void>;
  splitClip(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', splitTimeSeconds: number): Promise<boolean>;
  insertClip(trackIndex: number, trackType: 'video' | 'audio', projectItemPath: string, timeInSeconds: number): Promise<boolean>;
  overwriteClip(trackIndex: number, trackType: 'video' | 'audio', projectItemPath: string, timeInSeconds: number): Promise<boolean>;
  rippleDelete(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean>;
  liftClip(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean>;
  setClipEnabled(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', enabled: boolean): Promise<boolean>;
  getProjectBinItems(): Promise<import('./timeline').ProjectBinItem[]>;
  duplicateSequence(): Promise<{ originalName: string; backupName: string } | null>;
}

export interface AIServiceAPI {
  complete(prompt: string, options?: AICompletionOptions): Promise<string>;
  stream(prompt: string, options?: AICompletionOptions): AsyncIterable<string>;
  analyzeTimeline(context?: string): Promise<AITimelineAnalysis>;
}

export interface AICompletionOptions {
  maxTokens?: number;
  temperature?: number;
  system?: string;
  model?: string;
}

export interface AITimelineAnalysis {
  summary: string;
  suggestions: string[];
  structure: { start: number; end: number; label: string }[];
}

export interface MediaServiceAPI {
  getMetadata(filePath: string): Promise<import('./media').MediaMetadata>;
  detectSilence(filePath: string, options?: SilenceDetectionOptions): Promise<import('./media').SilentRegion[]>;
  getWaveform(filePath: string, options?: WaveformOptions): Promise<number[]>;
}

export interface SilenceDetectionOptions {
  threshold?: number; // dB, default -30
  minDuration?: number; // seconds, default 0.5
}

export interface WaveformOptions {
  samples?: number;
  channel?: number;
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface PluginDataStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface PluginUI {
  showToast(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  showProgress(label: string, progress: number): void;
  hideProgress(): void;
  pushToPanel(type: string, data: unknown): void;
}

export interface PluginDefinition<TConfig = Record<string, unknown>> {
  activate(ctx: PluginContext): Promise<void> | void;
  deactivate?(ctx: PluginContext): Promise<void> | void;
  commands?: Record<string, (ctx: PluginContext, args?: Record<string, unknown>) => Promise<unknown> | unknown>;
}
