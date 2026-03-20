/** Cutting Board Finder — cut detection types */

export type CutFinderStatus =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'detecting'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface CutFinderProgress {
  analysisId: string;
  status: CutFinderStatus;
  phase: string;
  percent: number;
  detail: string;
}

export interface DetectedCut {
  id: string;
  analysisId: string;
  cutIndex: number;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
  frameBefore: string;
  frameAfter: string;
  diffScore: number;
  intentTags?: string[];
  videoId?: string;
}

export interface CutFinderAnalysis {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnailUrl: string;
  thumbnailPath: string;
  status: CutFinderStatus;
  videoPath: string;
  framesDir: string;
  frameCount: number;
  cutCount: number;
  error: string;
  analysisTimeMs: number;
  createdAt: string;
  completedAt: string;
}

export interface CutFinderAnalysisSummary {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnailUrl: string;
  thumbnailPath: string;
  status: CutFinderStatus;
  cutCount: number;
  frameCount: number;
  createdAt: string;
}

export interface CutFinderExportOptions {
  analysisId: string;
  format: 'json' | 'markdown' | 'edl';
}
