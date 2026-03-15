import type { Sequence, Clip } from '@mayday/types';
import type { ClipFingerprint, TimelineSnapshot, EditChange } from './types.js';
import { createHash } from 'crypto';

const TOL = 0.01; // 10ms tolerance

function roundTime(t: number): number {
  return Math.round(t * 1e6) / 1e6;
}

function makeKey(clip: { name: string; mediaPath: string; trackIndex: number; trackType: string }): string {
  return `${clip.name}|${clip.mediaPath}|${clip.trackIndex}|${clip.trackType}`;
}

function clipToFingerprint(clip: Clip): ClipFingerprint {
  return {
    key: makeKey(clip),
    name: clip.name,
    mediaPath: clip.mediaPath,
    trackIndex: clip.trackIndex,
    trackType: clip.trackType,
    start: roundTime(clip.start),
    end: roundTime(clip.end),
    duration: roundTime(clip.duration),
    inPoint: roundTime(clip.inPoint),
    outPoint: roundTime(clip.outPoint),
  };
}

function hashFingerprints(clips: ClipFingerprint[]): string {
  const data = clips
    .map(c => `${c.key}:${c.start.toFixed(3)}:${c.end.toFixed(3)}:${c.inPoint.toFixed(3)}:${c.outPoint.toFixed(3)}`)
    .join('\n');
  return createHash('md5').update(data).digest('hex');
}

export function createSnapshot(seq: Sequence): TimelineSnapshot {
  const clips: ClipFingerprint[] = [];

  for (const track of seq.videoTracks) {
    for (const clip of track.clips) clips.push(clipToFingerprint(clip));
  }
  for (const track of seq.audioTracks) {
    for (const clip of track.clips) clips.push(clipToFingerprint(clip));
  }

  clips.sort((a, b) => {
    if (a.trackType !== b.trackType) return a.trackType < b.trackType ? -1 : 1;
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
    if (a.start !== b.start) return a.start - b.start;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  return {
    sequenceId: seq.sequenceId,
    sequenceName: seq.name,
    timestamp: Date.now(),
    clips,
    hash: hashFingerprints(clips),
  };
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < TOL;
}

export function diffSnapshots(prev: TimelineSnapshot, curr: TimelineSnapshot): EditChange[] {
  const changes: EditChange[] = [];

  const prevByKey = groupByKey(prev.clips);
  const currByKey = groupByKey(curr.clips);
  const allKeys = new Set([...prevByKey.keys(), ...currByKey.keys()]);

  for (const key of allKeys) {
    const prevClips = prevByKey.get(key) || [];
    const currClips = currByKey.get(key) || [];

    if (prevClips.length === 0 && currClips.length > 0) {
      for (const clip of currClips) changes.push(makeChange('add', clip.start, clip, null, clip));
      continue;
    }
    if (prevClips.length > 0 && currClips.length === 0) {
      for (const clip of prevClips) changes.push(makeChange('delete', clip.start, clip, clip, null));
      continue;
    }

    let remaining_prev = [...prevClips];
    let remaining_curr = [...currClips];

    // === PRE-PASS: Detect cuts FIRST ===
    // A cut: one prev clip splits into two curr clips whose combined span matches
    const cutPrev: Set<ClipFingerprint> = new Set();
    const cutCurr: Set<ClipFingerprint> = new Set();

    for (const pc of remaining_prev) {
      // Find two curr clips that span this prev clip
      const candidates = remaining_curr.filter(cc => !cutCurr.has(cc));
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          const first = a.start < b.start ? a : b;
          const second = a.start < b.start ? b : a;

          if (
            near(first.start, pc.start) &&
            near(second.end, pc.end) &&
            near(first.end, second.start)
          ) {
            changes.push({
              editType: 'cut',
              editPointTime: first.end,
              clipName: pc.name,
              mediaPath: pc.mediaPath,
              trackIndex: pc.trackIndex,
              trackType: pc.trackType,
              beforeState: pc,
              afterState: [first, second],
              isUndo: false,
            });
            cutPrev.add(pc);
            cutCurr.add(a);
            cutCurr.add(b);
          }
        }
        if (cutPrev.has(pc)) break;
      }
    }

    // Remove clips consumed by cuts
    remaining_prev = remaining_prev.filter(c => !cutPrev.has(c));
    remaining_curr = remaining_curr.filter(c => !cutCurr.has(c));

    // === MATCHING PASSES ===

    // Pass 1: match by media content (inPoint + outPoint) — survives moves
    remaining_prev = matchPass(remaining_prev, remaining_curr, changes,
      (pc, cc) => near(pc.inPoint, cc.inPoint) && near(pc.outPoint, cc.outPoint));

    // Pass 2: match by timeline position (start + end)
    remaining_prev = matchPass(remaining_prev, remaining_curr, changes,
      (pc, cc) => near(pc.start, cc.start) && near(pc.end, cc.end));

    // Pass 3: match by end + outPoint (stable for trim-head)
    remaining_prev = matchPass(remaining_prev, remaining_curr, changes,
      (pc, cc) => near(pc.end, cc.end) && near(pc.outPoint, cc.outPoint));

    // Pass 4: match by start + inPoint (stable for trim-tail)
    remaining_prev = matchPass(remaining_prev, remaining_curr, changes,
      (pc, cc) => near(pc.start, cc.start) && near(pc.inPoint, cc.inPoint));

    // === REMAINING: deletes and adds ===
    for (const clip of remaining_prev) {
      changes.push(makeChange('delete', clip.start, clip, clip, null));
    }
    for (const clip of remaining_curr) {
      changes.push(makeChange('add', clip.start, clip, null, clip));
    }
  }

  // Filter: drop moves that co-occur with a delete (ripple side-effects)
  const hasDelete = changes.some(c => c.editType === 'delete');
  const filtered = hasDelete
    ? changes.filter(c => c.editType !== 'move')
    : changes;

  // Filter: drop ripple moves (3+ simultaneous moves)
  const moves = filtered.filter(c => c.editType === 'move');
  if (moves.length >= 3) {
    return filtered.filter(c => c.editType !== 'move');
  }

  return deduplicateLinked(filtered);
}

/**
 * Run a matching pass: for each unmatched prev clip, try to find a curr clip
 * using the given predicate. Matched pairs are analyzed for changes.
 * Returns the still-unmatched prev clips.
 */
function matchPass(
  remaining_prev: ClipFingerprint[],
  remaining_curr: ClipFingerprint[],
  changes: EditChange[],
  predicate: (pc: ClipFingerprint, cc: ClipFingerprint) => boolean,
): ClipFingerprint[] {
  const still_unmatched: ClipFingerprint[] = [];

  for (const pc of remaining_prev) {
    const idx = remaining_curr.findIndex(cc => predicate(pc, cc));
    if (idx >= 0) {
      const cc = remaining_curr[idx];
      remaining_curr.splice(idx, 1);
      classifyChange(pc, cc, changes);
    } else {
      still_unmatched.push(pc);
    }
  }

  return still_unmatched;
}

/**
 * Classify the change between a matched prev/curr clip pair.
 */
function classifyChange(p: ClipFingerprint, c: ClipFingerprint, changes: EditChange[]): void {
  const startDiff = Math.abs(p.start - c.start);
  const endDiff = Math.abs(p.end - c.end);
  const inDiff = Math.abs(p.inPoint - c.inPoint);
  const outDiff = Math.abs(p.outPoint - c.outPoint);

  // No meaningful change
  if (startDiff < TOL && endDiff < TOL) return;

  if (startDiff > TOL && endDiff < TOL && inDiff > TOL) {
    changes.push(makeChange('trim-head', c.start, c, p, c));
  } else if (startDiff < TOL && endDiff > TOL && outDiff > TOL) {
    changes.push(makeChange('trim-tail', c.end, c, p, c));
  } else if (startDiff > TOL && endDiff > TOL && inDiff < TOL && outDiff < TOL) {
    changes.push(makeChange('move', c.start, c, p, c));
  } else if (startDiff > TOL || endDiff > TOL) {
    const type = startDiff > endDiff ? 'trim-head' : 'trim-tail';
    changes.push(makeChange(type, startDiff > endDiff ? c.start : c.end, c, p, c));
  }
}

function makeChange(
  editType: EditChange['editType'],
  editPointTime: number,
  clip: ClipFingerprint,
  beforeState: ClipFingerprint | ClipFingerprint[] | null,
  afterState: ClipFingerprint | ClipFingerprint[] | null,
): EditChange {
  return {
    editType, editPointTime,
    clipName: clip.name, mediaPath: clip.mediaPath,
    trackIndex: clip.trackIndex, trackType: clip.trackType,
    beforeState, afterState, isUndo: false,
  };
}

/**
 * Deduplicate linked audio+video edits arriving in the same diff.
 */
function deduplicateLinked(changes: EditChange[]): EditChange[] {
  const seen = new Map<string, EditChange>();
  const result: EditChange[] = [];

  const sorted = [...changes].sort((a, b) => {
    if (a.trackType === 'video' && b.trackType !== 'video') return -1;
    if (a.trackType !== 'video' && b.trackType === 'video') return 1;
    return 0;
  });

  for (const c of sorted) {
    const timeKey = (Math.round(c.editPointTime * 10) / 10).toFixed(1);
    const dedupeKey = `${c.editType}|${timeKey}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, c);
      result.push(c);
    }
  }
  return result;
}

export function checkForUndo(curr: TimelineSnapshot, history: TimelineSnapshot[]): boolean {
  if (history.length < 2) return false;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].hash === curr.hash) return true;
  }
  return false;
}

function groupByKey(clips: ClipFingerprint[]): Map<string, ClipFingerprint[]> {
  const map = new Map<string, ClipFingerprint[]>();
  for (const clip of clips) {
    if (!map.has(clip.key)) map.set(clip.key, []);
    map.get(clip.key)!.push(clip);
  }
  return map;
}
