import type { Sequence } from '@mayday/sdk';
import type { AutocutSuggestion, EditParameters } from './autocut-types.js';

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

export function buildInferenceInput(
  clip: Clip,
  playheadPosition: number,
  recentEdits: Array<{ editType: string; timestamp: number; quality: string }>,
  neighborBefore: Clip | null,
  neighborAfter: Clip | null,
): number[] {
  const trackType = clip.trackType === 'audio' ? 1 : 0;
  const trackIndex = Math.min(clip.trackIndex / MAX_TRACK_INDEX, 1);
  const clipDuration = Math.min(clip.duration / MAX_DURATION, 1);
  const clipPosition = Math.min(clip.start / 600, 1);

  const playheadInClip = clip.duration > 0
    ? Math.max(0, Math.min(1, (playheadPosition - clip.start) / clip.duration))
    : 0.5;
  const now = Date.now();
  const lastEditTime = recentEdits.length > 0 ? recentEdits[recentEdits.length - 1].timestamp : 0;
  const timeSinceLastEdit = lastEditTime > 0 ? Math.min((now - lastEditTime) / 60_000, 1) : 1;

  const hasNeighborBefore = neighborBefore ? 1 : 0;
  const hasNeighborAfter = neighborAfter ? 1 : 0;
  const gapBefore = neighborBefore
    ? Math.min(Math.max(0, clip.start - neighborBefore.end) / MAX_GAP, 1)
    : 0;
  const gapAfter = neighborAfter
    ? Math.min(Math.max(0, neighborAfter.start - clip.end) / MAX_GAP, 1)
    : 0;

  const last10 = recentEdits.slice(-10);
  const total = Math.max(last10.length, 1);
  const recentCutFrac = last10.filter(e => e.editType === 'cut').length / total;
  const recentTrimHeadFrac = last10.filter(e => e.editType === 'trim-head').length / total;
  const recentTrimTailFrac = last10.filter(e => e.editType === 'trim-tail').length / total;
  const recentDeleteFrac = last10.filter(e => e.editType === 'delete').length / total;

  const approved = last10.filter(e => e.quality !== 'bad').length;
  const recentApprovalRate = last10.length > 0 ? approved / last10.length : 0.5;

  return [
    trackType, trackIndex, clipDuration, clipPosition,
    playheadInClip, timeSinceLastEdit,
    hasNeighborBefore, hasNeighborAfter, gapBefore, gapAfter,
    recentCutFrac, recentTrimHeadFrac, recentTrimTailFrac, recentDeleteFrac,
    recentApprovalRate,
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
