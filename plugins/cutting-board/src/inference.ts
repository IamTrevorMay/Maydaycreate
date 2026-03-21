import type { Sequence } from '@mayday/sdk';
import type { AutocutSuggestion, EditParameters } from './autocut-types.js';
import { INTENT_TAGS } from '@mayday/types';

type Clip = Sequence['videoTracks'][number]['clips'][number];

const MAX_DURATION = 60;
const MAX_GAP = 10;
const MAX_TRACK_INDEX = 10;

interface ClipTarget {
  clip: Clip;
  trackIndex: number;
  trackType: 'video' | 'audio';
  clipIndex: number;
  neighborBefore: Clip | null;
  neighborAfter: Clip | null;
}

export function findTargetClip(sequence: Sequence, playheadPosition: number): ClipTarget | null {
  for (const trackType of ['video', 'audio'] as const) {
    const tracks = trackType === 'video' ? sequence.videoTracks : sequence.audioTracks;
    for (const track of tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i];
        if (playheadPosition >= clip.start && playheadPosition <= clip.end) {
          return {
            clip,
            trackIndex: track.index,
            trackType,
            clipIndex: i,
            neighborBefore: i > 0 ? track.clips[i - 1] : null,
            neighborAfter: i < track.clips.length - 1 ? track.clips[i + 1] : null,
          };
        }
      }
    }
  }

  // No clip under playhead — find nearest within 5s
  let nearest: (ClipTarget & { dist: number }) | null = null;
  for (const trackType of ['video', 'audio'] as const) {
    const tracks = trackType === 'video' ? sequence.videoTracks : sequence.audioTracks;
    for (const track of tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i];
        const dist = Math.min(
          Math.abs(clip.start - playheadPosition),
          Math.abs(clip.end - playheadPosition),
        );
        if (!nearest || dist < nearest.dist) {
          nearest = {
            clip, dist, trackIndex: track.index, trackType, clipIndex: i,
            neighborBefore: i > 0 ? track.clips[i - 1] : null,
            neighborAfter: i < track.clips.length - 1 ? track.clips[i + 1] : null,
          };
        }
      }
    }
  }

  if (nearest && nearest.dist < 5) {
    const { dist, ...result } = nearest;
    return result;
  }

  return null;
}

/**
 * Build inference input vector that matches featureToVector() in model.ts exactly.
 *
 * Training feature vector (from model.ts featureToVector):
 *   [0] trackType        — 0=video, 1=audio
 *   [1] trackIndex       — normalized by MAX_TRACK_INDEX
 *   [2] clipDuration     — beforeDuration / MAX_DURATION, fallback 0.5
 *   [3] clipPosition     — editPointTime / 600
 *   [4] playheadInClip   — splitRatio, fallback 0.5
 *   [5] timeSinceLastEdit — delta to previous edit / 60000ms, fallback 1
 *   [6] hasNeighborBefore — always 0 (training never populates neighbors)
 *   [7] hasNeighborAfter  — always 0 (training never populates neighbors)
 *   [8] gapBefore         — always 0 (training never populates neighbors)
 *   [9] gapAfter          — always 0 (training never populates neighbors)
 *  [10] recentCutFrac
 *  [11] recentTrimHeadFrac
 *  [12] recentTrimTailFrac
 *  [13] recentDeleteFrac
 *  [14] recentApprovalRate — fallback 0.5
 *  [15] audioLevel         — RMS level at point (0-1)
 *  [16] audioLevelDelta    — change in level (-1 to 1)
 *  [17] isOnSilence        — 1 if in a silent region
 *  [18-24] intent tags     — one-hot (silence, misspeak, cadence, false-start, transition, pacing, redundancy)
 */
export function buildInferenceInput(
  clip: Clip,
  _playheadPosition: number,
  recentEdits: Array<{ editType: string; timestamp: number; quality: string }>,
  _neighborBefore: Clip | null,
  _neighborAfter: Clip | null,
  audioFeatures?: { audioLevel: number; audioLevelDelta: number; isOnSilence: boolean },
  tags?: string[],
): number[] {
  // Match training: trackType
  const trackType = clip.trackType === 'audio' ? 1 : 0;

  // Match training: trackIndex / MAX_TRACK_INDEX
  const trackIndex = Math.min(clip.trackIndex / MAX_TRACK_INDEX, 1);

  // Match training: beforeDuration / MAX_DURATION with 0.5 fallback
  // At inference time, clip.duration IS the "before" duration (pre-edit state)
  const clipDuration = clip.duration != null ? Math.min(clip.duration / MAX_DURATION, 1) : 0.5;

  // Match training: editPointTime / 600
  // Use clip midpoint as the edit point estimate
  const clipPosition = Math.min((clip.start + clip.duration * 0.5) / 600, 1);

  // Match training: splitRatio ?? 0.5
  // During scan we don't know where the user would cut, so use 0.5 (same as training default)
  const playheadInClip = 0.5;

  // Match training: timeSinceLastEdit
  const now = Date.now();
  const lastEditTime = recentEdits.length > 0 ? recentEdits[recentEdits.length - 1].timestamp : 0;
  const timeSinceLastEdit = lastEditTime > 0 ? Math.min((now - lastEditTime) / 60_000, 1) : 1;

  // Match training: neighbors are ALWAYS null in training data (pipeline.ts line 48-49)
  // so these features are always 0 during training. We must match that.
  const hasNeighborBefore = 0;
  const hasNeighborAfter = 0;
  const gapBefore = 0;
  const gapAfter = 0;

  // Match training: recent edit fractions
  const last10 = recentEdits.slice(-10);
  const total = Math.max(last10.length, 1);
  const recentCutFrac = last10.filter(e => e.editType === 'cut').length / total;
  const recentTrimHeadFrac = last10.filter(e => e.editType === 'trim-head').length / total;
  const recentTrimTailFrac = last10.filter(e => e.editType === 'trim-tail').length / total;
  const recentDeleteFrac = last10.filter(e => e.editType === 'delete').length / total;

  // Match training: approval rate with 0.5 fallback
  const ratedEdits = last10.filter(e => e.quality !== 'bad');
  const recentApprovalRate = last10.length > 0 ? ratedEdits.length / last10.length : 0.5;

  // Audio features
  const audioLevel = audioFeatures?.audioLevel ?? 0.5;
  const audioLevelDelta = Math.max(-1, Math.min(1, audioFeatures?.audioLevelDelta ?? 0));
  const isOnSilence = audioFeatures?.isOnSilence ? 1 : 0;

  // Intent tags — during scan these are empty (no tags for unedited footage)
  const tagFeatures = INTENT_TAGS.map(tag =>
    tags?.includes(tag.id) ? 1 : 0
  );

  return [
    trackType, trackIndex, clipDuration, clipPosition,
    playheadInClip, timeSinceLastEdit,
    hasNeighborBefore, hasNeighborAfter, gapBefore, gapAfter,
    recentCutFrac, recentTrimHeadFrac, recentTrimTailFrac, recentDeleteFrac,
    recentApprovalRate,
    // Audio features [15-17]
    audioLevel, audioLevelDelta, isOnSilence,
    // Intent tags [18-24]
    ...tagFeatures,
  ];
}

export function runInference(
  input: number[],
  classifier: any,
  regressors: Map<string, any>,
  clip: { trackIndex: number; trackType: 'video' | 'audio'; clipIndex: number; name: string; start: number; end: number; duration: number },
  threshold: number,
): AutocutSuggestion | null {
  const classifierOutput = classifier.run(input) as Record<string, number>;

  const sorted = Object.entries(classifierOutput).sort((a, b) => b[1] - a[1]);
  const [bestType, bestConfidence] = sorted[0];

  if (bestConfidence < threshold) return null;

  let parameters: EditParameters = {};
  const regressor = regressors.get(bestType);
  if (regressor) {
    const paramOutput = regressor.run(input) as number[];
    parameters = decodeParameters(bestType, Array.from(paramOutput), clip.duration);
  } else {
    parameters = defaultParameters(bestType, clip.duration);
  }

  return {
    editType: bestType as any,
    confidence: bestConfidence,
    parameters,
    targetClip: {
      trackIndex: clip.trackIndex,
      trackType: clip.trackType,
      clipIndex: clip.clipIndex,
      clipName: clip.name,
      start: clip.start,
      end: clip.end,
    },
    createdAt: Date.now(),
  };
}

function decodeParameters(editType: string, output: number[], clipDuration: number): EditParameters {
  const val = output[0] ?? 0.5;
  switch (editType) {
    case 'cut':
      return { splitRatio: Math.max(0.05, Math.min(0.95, val)) };
    case 'trim-head':
    case 'trim-tail':
      return { trimAmount: val * Math.min(clipDuration, MAX_DURATION) };
    case 'delete':
      return { ripple: val > 0.5 };
    default:
      return {};
  }
}

function defaultParameters(editType: string, clipDuration: number): EditParameters {
  switch (editType) {
    case 'cut':
      return { splitRatio: 0.5 };
    case 'trim-head':
    case 'trim-tail':
      return { trimAmount: clipDuration * 0.1 };
    case 'delete':
      return { ripple: true };
    default:
      return {};
  }
}
