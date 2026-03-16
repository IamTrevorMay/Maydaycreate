import type { EditType } from '@mayday/types';

export const EDIT_TYPES: EditType[] = ['cut', 'trim-head', 'trim-tail', 'delete', 'move', 'add'];

export interface EditParameters {
  splitRatio?: number;
  trimAmount?: number;
  ripple?: boolean;
}

export interface AutocutSuggestion {
  editType: EditType;
  confidence: number;
  parameters: EditParameters;
  targetClip: {
    trackIndex: number;
    trackType: 'video' | 'audio';
    clipIndex: number;
    clipName: string;
    start: number;
    end: number;
  };
  createdAt: number;
}

export interface SerializedModel {
  version: number;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  classifier: object;
  regressors: Record<string, object>;
}
