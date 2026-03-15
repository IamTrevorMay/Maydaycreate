/** Effect capture & preset types for Preset Vault */

export interface EffectKeyframe {
  time: number;
  value: unknown;
}

export interface EffectProperty {
  displayName: string;
  matchName: string;
  type: number;
  value: unknown;
  keyframes: EffectKeyframe[] | null;
}

export interface CapturedEffect {
  displayName: string;
  matchName: string;
  index: number;
  isIntrinsic: boolean;
  properties: EffectProperty[];
}

export interface EffectCaptureResult {
  clipName: string;
  trackType: 'video' | 'audio';
  capturedAt: string;
  effects: CapturedEffect[];
}

export interface EffectApplyResult {
  applied: string[];
  skipped: string[];
  errors: string[];
}

export interface EffectPreset {
  id: string;
  name: string;
  version: number;
  tags: string[];
  folder: string;
  description: string;
  sourceClipName: string;
  includeIntrinsics: boolean;
  createdAt: string;
  updatedAt: string;
  effects: CapturedEffect[];
}

export interface PresetIndexEntry {
  id: string;
  name: string;
  tags: string[];
  folder: string;
  effectCount: number;
  sourceClipName: string;
  createdAt: string;
  updatedAt: string;
}

export interface PresetFolder {
  name: string;
  path: string;
  children: PresetFolder[];
  presetCount: number;
}

export interface PresetLibraryIndex {
  version: number;
  presets: PresetIndexEntry[];
  folders: PresetFolder[];
  lastUpdated: string;
}

export interface EffectsServiceAPI {
  captureEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<EffectCaptureResult>;
  getSelectedClipInfo(): Promise<{ trackIndex: number; clipIndex: number; trackType: 'video' | 'audio'; clipName: string } | null>;
  captureFromSelected(): Promise<EffectCaptureResult | null>;
  applyEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', effectsJson: string): Promise<EffectApplyResult>;
  removeAllEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean>;
  listAvailableEffects(): Promise<string[]>;
}

export interface ExcaliburPresetCommand {
  presetId: string;
  presetName: string;
  curlCommand: string;
  description: string;
}
