/** YouTube video reverse-engineering analysis types */

export type AnalysisStatus =
  | 'queued'
  | 'downloading'
  | 'extracting'
  | 'analyzing'
  | 'paused'
  | 'complete'
  | 'error'
  | 'cancelled';

export interface AnalysisProgress {
  analysisId: string;
  status: AnalysisStatus;
  phase: string;
  percent: number;
  detail: string;
}

export interface YouTubeVideoInfo {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnailUrl: string;
  uploadDate: string;
  description: string;
  resolution: string;
  fps: number;
}

export interface VideoAnalysis {
  id: string;
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  thumbnailUrl: string;
  thumbnailPath: string;
  uploadDate: string;
  description: string;
  resolution: string;
  fps: number;
  status: AnalysisStatus;
  videoPath: string;
  framesDir: string;
  frameCount: number;
  effectCount: number;
  summary: string;
  styleNotes: string;
  error: string;
  analysisTimeMs: number;
  createdAt: string;
  completedAt: string;
}

export interface VideoAnalysisSummary {
  id: string;
  title: string;
  channel: string;
  duration: number;
  thumbnailUrl: string;
  thumbnailPath: string;
  status: AnalysisStatus;
  effectCount: number;
  ratedCount: number;
  createdAt: string;
}

export type FrameExtractionMethod = 'scene-detect' | 'interval';

export interface ExtractedFrame {
  id: string;
  analysisId: string;
  frameIndex: number;
  timestamp: number;
  filePath: string;
  thumbnailPath: string;
  method: FrameExtractionMethod;
  sceneScore: number | null;
}

export type EffectCategory =
  | 'cut'
  | 'transition'
  | 'color-grade'
  | 'text-overlay'
  | 'blur'
  | 'scale'
  | 'opacity'
  | 'speed-ramp'
  | 'mask'
  | 'composite'
  | 'audio-visual'
  | 'motion-graphics'
  | 'stabilization'
  | 'lens-effect'
  | 'other';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface PremiereRecreation {
  steps: string[];
  suggestedEffects: string[];
  estimatedParameters: Record<string, string>;
  notes: string;
}

export interface DetectedEffect {
  id: string;
  analysisId: string;
  effectIndex: number;
  startTime: number;
  endTime: number;
  category: EffectCategory;
  secondaryCategories: EffectCategory[];
  description: string;
  confidence: ConfidenceLevel;
  frameBefore: string;
  frameAfter: string;
  premiereRecreation: PremiereRecreation;
  rating: number | null;
  correctionNote: string;
  sourceIdentification: string;
  savedPresetId: string | null;
  source?: 'ai' | 'local';
}

export interface TrainingCorrection {
  id: string;
  effectId: string;
  analysisId: string;
  originalCategory: string;
  correctedCategory: string | null;
  originalDescription: string;
  correctionNote: string;
  frameBeforePath: string;
  frameAfterPath: string;
  createdAt: string;
}

export interface TrainingStats {
  totalEffects: number;
  ratedEffects: number;
  thumbsUp: number;
  thumbsDown: number;
  corrections: number;
  accuracyPercent: number;
  ratingDistribution: [number, number, number, number, number];
  averageRating: number;
}

export interface BatchQueueItem {
  id: string;
  url: string;
  title: string;
  status: 'queued' | 'processing' | 'complete' | 'error';
  position: number;
  analysisId: string | null;
}

export interface AnalysisOptions {
  skipCuts?: boolean;
}

export type ExportFormat = 'markdown' | 'json';

export interface ExportOptions {
  analysisId: string;
  format: ExportFormat;
  includeFramePaths: boolean;
}
