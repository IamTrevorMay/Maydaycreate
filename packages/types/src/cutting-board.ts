export interface CuttingBoardAggregateStats {
  totalEdits: number;
  totalSessions: number;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoRate: number;
  editsByType: Record<string, number>;
  tagCounts: Record<string, number>;
  recentSessions: Array<{
    id: number;
    sequenceName: string;
    startedAt: number;
    totalEdits: number;
    approvalRate: number | null;
  }>;
}

export interface CuttingBoardJoinResult {
  videoId: string;
  modelAVideoId: string;
  modelBVideoId: string;
  totalModelA: number;
  totalModelB: number;
  matched: number;
  unmatchedA: number;
  unmatchedB: number;
  written: number;
}

export interface CuttingBoardTrainingRun {
  id: number;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  version: number;
}
