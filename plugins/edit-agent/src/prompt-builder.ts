import type { Sequence, Track, Clip } from '@mayday/types';
import type { TrainingExample } from '../../cutting-board/src/pipeline.js';

const SYSTEM_PROMPT = `You are an expert video editor AI assistant. You analyze timeline state and suggest precise edit operations.

RULES:
- Only suggest edits you are confident about
- Never suggest edits on locked or muted tracks
- Prefer conservative edits (trims) over destructive ones (deletes)
- Each suggestion must include exact parameters for execution
- Respond ONLY with a JSON array, no other text

RESPONSE FORMAT:
[
  {
    "editType": "trim-head" | "trim-tail" | "split" | "delete" | "insert" | "move" | "enable" | "disable",
    "description": "Human-readable description of the edit",
    "confidence": 0.0-1.0,
    "reasoning": "Why this edit improves the timeline",
    "trackIndex": number,
    "trackType": "video" | "audio",
    "clipIndex": number,
    "params": {
      "splitTime": number (seconds, for split),
      "newInPoint": number (seconds, for trim-head),
      "newOutPoint": number (seconds, for trim-tail),
      "ripple": boolean (for delete),
      "insertTime": number (seconds, for insert/move),
      "projectItemPath": string (media path, for insert),
      "moveToTime": number (seconds, for move),
      "enabled": boolean (for enable/disable)
    }
  }
]`;

export function buildAnalysisPrompt(
  sequence: Sequence,
  examples: TrainingExample[],
  userInstruction?: string,
  proposalStats?: { total: number; accepted: number; avgConfidenceAccepted: number },
): string {
  const parts: string[] = [];

  // Current timeline state
  parts.push('## Current Timeline State');
  parts.push(`Sequence: "${sequence.name}" | Duration: ${sequence.duration.toFixed(2)}s | Frame Rate: ${sequence.frameRate}`);
  parts.push('');

  // Video tracks
  for (const track of sequence.videoTracks) {
    if (track.clips.length === 0) continue;
    parts.push(formatTrack(track));
  }

  // Audio tracks
  for (const track of sequence.audioTracks) {
    if (track.clips.length === 0) continue;
    parts.push(formatTrack(track));
  }

  parts.push('');

  // Historical patterns from ExampleBank
  if (examples.length > 0) {
    parts.push('## Editor\'s Historical Patterns');
    parts.push('These are edits the editor has made before, rated by quality:');
    for (const ex of examples) {
      const qualityTag = ex.quality === 'boosted' ? '[EXCELLENT]'
        : ex.quality === 'good' ? '[GOOD]'
        : '[AVOID]';
      const details: string[] = [];
      if (ex.action.deltaDuration != null) details.push(`delta=${ex.action.deltaDuration.toFixed(2)}s`);
      if (ex.action.splitRatio != null) details.push(`splitRatio=${ex.action.splitRatio.toFixed(2)}`);
      parts.push(`  ${qualityTag} ${ex.editType} on "${ex.context.clipName}" at ${ex.context.editPointTime.toFixed(2)}s${details.length ? ' | ' + details.join(', ') : ''}`);
    }
    parts.push('');
  }

  // Acceptance history for calibration
  if (proposalStats && proposalStats.total > 10) {
    const acceptRate = ((proposalStats.accepted / proposalStats.total) * 100).toFixed(0);
    parts.push('## Your Past Accuracy');
    parts.push(`Of your ${proposalStats.total} previous suggestions, ${acceptRate}% were accepted. Average confidence of accepted edits: ${(proposalStats.avgConfidenceAccepted * 100).toFixed(0)}%. Calibrate accordingly.`);
    parts.push('');
  }

  // User instruction
  if (userInstruction) {
    parts.push('## User Instruction');
    parts.push(userInstruction);
    parts.push('');
  }

  parts.push('Analyze the timeline and suggest edits. Return a JSON array of proposals.');

  return parts.join('\n');
}

export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

function formatTrack(track: Track): string {
  const lockTag = track.locked ? ' [LOCKED]' : '';
  const muteTag = track.muted ? ' [MUTED]' : '';
  const lines = [`### ${track.type.toUpperCase()} Track ${track.index}: "${track.name}"${lockTag}${muteTag}`];

  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i];
    const gap = i > 0 ? clip.start - track.clips[i - 1].end : 0;
    if (gap > 0.1) {
      lines.push(`  [GAP ${gap.toFixed(2)}s]`);
    }
    lines.push(formatClip(clip, i));
  }

  return lines.join('\n');
}

function formatClip(clip: Clip, index: number): string {
  const enabled = clip.enabled ? '' : ' [DISABLED]';
  return `  [${index}] "${clip.name}" ${clip.start.toFixed(2)}s-${clip.end.toFixed(2)}s (dur=${clip.duration.toFixed(2)}s, in=${clip.inPoint.toFixed(2)}, out=${clip.outPoint.toFixed(2)}, speed=${clip.speed})${enabled}`;
}
