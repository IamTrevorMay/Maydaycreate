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

export interface CuttingBoardSession {
  id: number;
  sequenceId: string;
  sequenceName: string;
  sessionName: string | null;
  videoId: string | null;
  startedAt: number;
  endedAt: number | null;
  totalEdits: number;
  cutCount: number;
  taggedCount: number;
}

export interface CloudTrainingRun {
  id: string;              // "machineId:version" composite key
  machineId: string;
  machineName: string;
  version: number;
  trainedAt: number;
  trainingSize: number;
  accuracy: number;
  isBest: boolean;         // true for the single highest-accuracy row
}

export interface CuttingBoardTrainingDataSummary {
  totalRecords: number;
  ratedCount: number;
  unratedCount: number;
  taggedCount: number;
  untaggedCount: number;
  boostedCount: number;
  badCount: number;
  unsyncedCount: number;
}
