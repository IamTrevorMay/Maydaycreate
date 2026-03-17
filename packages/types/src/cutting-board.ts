export interface CuttingBoardAggregateStats {
  totalEdits: number;
  totalSessions: number;
  approvalRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  boostedCount: number;
  undoRate: number;
  editsByType: Record<string, number>;
  recentSessions: Array<{
    id: number;
    sequenceName: string;
    startedAt: number;
    totalEdits: number;
    approvalRate: number | null;
  }>;
}

export interface CuttingBoardTrainingRun {
  id: number;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  version: number;
}
