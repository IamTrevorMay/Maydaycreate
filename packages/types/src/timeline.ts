/** Timeline and sequence types matching Premiere Pro's object model */

export interface Sequence {
  id: string;
  name: string;
  sequenceId: string;
  frameSizeHorizontal: number;
  frameSizeVertical: number;
  frameRate: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  zeroPoint: number;
  videoTracks: Track[];
  audioTracks: Track[];
}

export interface Track {
  index: number;
  name: string;
  type: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
  clips: Clip[];
}

export interface Clip {
  id: string;
  name: string;
  mediaPath: string;
  trackIndex: number;
  trackType: 'video' | 'audio';
  start: number;
  end: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  speed: number;
  enabled: boolean;
}

export interface Marker {
  id: string;
  name: string;
  start: number;
  end: number;
  type: string;
  color: MarkerColor;
  comment: string;
}

export type MarkerColor = 'green' | 'red' | 'purple' | 'orange' | 'yellow' | 'white' | 'blue' | 'cyan';

export interface PlayheadInfo {
  position: number;
  sequenceId: string;
}

export interface ProjectBinItem {
  name: string;
  path: string;
  type: 'bin' | 'clip';
  mediaPath: string;
}
