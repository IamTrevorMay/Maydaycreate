import type { EditType } from '@mayday/types';

export interface ClipFingerprint {
  /** Composite identity: name + mediaPath + trackIndex + trackType */
  key: string;
  name: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  start: number;
  end: number;
  duration: number;
  inPoint: number;
  outPoint: number;
}

export interface TimelineSnapshot {
  sequenceId: string;
  sequenceName: string;
  timestamp: number;
  clips: ClipFingerprint[];
  hash: string;
}

export interface EditChange {
  editType: EditType;
  editPointTime: number;
  clipName: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  beforeState: ClipFingerprint | ClipFingerprint[] | null;
  afterState: ClipFingerprint | ClipFingerprint[] | null;
  isUndo: boolean;
}

export interface CutRecord {
  id?: number;
  sessionId: number;
  editType: EditType;
  editPointTime: number;
  clipName: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  beforeState: string; // JSON
  afterState: string; // JSON
  audioCategory: string | null;
  rating: number | null;
  voiceTranscript: string | null;
  notes: string | null;
  isUndo: boolean;
  detectedAt: number;
  feedbackAt: number | null;
}

export interface Session {
  id?: number;
  sequenceId: string;
  sequenceName: string;
  startedAt: number;
  endedAt: number | null;
  totalEdits: number;
}
