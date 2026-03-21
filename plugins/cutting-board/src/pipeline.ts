import type { CutRecord } from './types.js';

export interface EditContext {
  clipName: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  editPointTime: number;
  beforeDuration: number | null;
  afterDuration: number | null;
  neighborBefore: { name: string; end: number } | null;
  neighborAfter: { name: string; start: number } | null;
}

export interface EditAction {
  editType: string;
  deltaDuration: number | null;
  deltaStart: number | null;
  deltaEnd: number | null;
  splitRatio: number | null;
}

export interface TrainingExample {
  id: number;
  editType: string;
  quality: 'boosted' | 'good' | 'bad';
  weight: number;
  context: EditContext;
  action: EditAction;
  timestamp: number;
  tags: string[];
  audioLevel: number;       // RMS level at edit point (0-1)
  audioLevelDelta: number;  // change in level around edit point (-1 to 1)
  isOnSilence: boolean;     // true if edit point is within a silent region
}

export function extractFeatures(record: CutRecord & { quality: string; weight: number; intent_tags?: string; audio_level?: number; audio_level_delta?: number; is_on_silence?: number }): TrainingExample {
  const before = safeParseState(record.beforeState);
  const after = safeParseState(record.afterState);

  const beforeDuration = before ? (before.end - before.start) : null;
  const afterDuration = after ? (after.end - after.start) : null;

  const context: EditContext = {
    clipName: record.clipName,
    mediaPath: record.mediaPath,
    trackIndex: record.trackIndex,
    trackType: record.trackType,
    editPointTime: record.editPointTime,
    beforeDuration,
    afterDuration,
    neighborBefore: null,
    neighborAfter: null,
  };

  const deltaDuration = (beforeDuration != null && afterDuration != null)
    ? afterDuration - beforeDuration : null;
  const deltaStart = (before && after) ? after.start - before.start : null;
  const deltaEnd = (before && after) ? after.end - before.end : null;

  let splitRatio: number | null = null;
  if (record.editType === 'cut' && before && beforeDuration && beforeDuration > 0) {
    splitRatio = (record.editPointTime - before.start) / beforeDuration;
  }

  const action: EditAction = {
    editType: record.editType,
    deltaDuration,
    deltaStart,
    deltaEnd,
    splitRatio,
  };

  // Parse tags from DB JSON column
  let tags: string[] = [];
  try { tags = record.intent_tags ? JSON.parse(record.intent_tags) : []; } catch { tags = []; }

  return {
    id: record.id!,
    editType: record.editType,
    quality: record.quality as TrainingExample['quality'],
    weight: record.weight,
    context,
    action,
    timestamp: record.detectedAt,
    tags,
    audioLevel: record.audio_level ?? 0.5,
    audioLevelDelta: record.audio_level_delta ?? 0,
    isOnSilence: (record.is_on_silence ?? 0) === 1,
  };
}

export function toJSONL(examples: TrainingExample[]): string {
  return examples.map(ex => JSON.stringify(ex)).join('\n');
}

export function formatForPrompt(examples: TrainingExample[], limit = 10): string {
  const selected = examples
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit);

  if (selected.length === 0) return '';

  const lines = selected.map(ex => {
    const qualityTag = ex.quality === 'boosted' ? '[EXCELLENT]'
      : ex.quality === 'good' ? '[GOOD]'
      : '[AVOID]';

    return `${qualityTag} ${ex.editType} on "${ex.context.clipName}" at ${ex.context.editPointTime.toFixed(2)}s` +
      (ex.action.deltaDuration != null ? ` | delta=${ex.action.deltaDuration.toFixed(2)}s` : '') +
      (ex.action.splitRatio != null ? ` | splitRatio=${ex.action.splitRatio.toFixed(2)}` : '');
  });

  return `Editor's historical edit patterns:\n${lines.join('\n')}`;
}

function safeParseState(stateJson: string | null): { start: number; end: number; duration: number } | null {
  if (!stateJson) return null;
  try {
    const parsed = JSON.parse(stateJson);
    // Handle both single clip and array
    const clip = Array.isArray(parsed) ? parsed[0] : parsed;
    if (clip && typeof clip.start === 'number') return clip;
    return null;
  } catch {
    return null;
  }
}
