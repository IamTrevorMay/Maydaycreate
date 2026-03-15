export type AgentMode = 'suggest' | 'preview' | 'auto';

export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'executed' | 'failed';

export type ProposedActionType = 'split' | 'trim-head' | 'trim-tail' | 'delete' | 'insert' | 'move' | 'enable' | 'disable';

export interface ProposedAction {
  type: ProposedActionType;
  trackIndex: number;
  trackType: 'video' | 'audio';
  clipIndex: number;
  params: {
    splitTime?: number;
    newInPoint?: number;
    newOutPoint?: number;
    ripple?: boolean;
    insertTime?: number;
    projectItemPath?: string;
    moveToTime?: number;
    enabled?: boolean;
  };
}

export interface EditProposal {
  id: number;
  editType: ProposedActionType;
  description: string;
  confidence: number;
  reasoning: string;
  action: ProposedAction;
  status: ProposalStatus;
  createdAt: number;
  executedAt: number | null;
  sessionId: number;
}

export interface AgentState {
  mode: AgentMode;
  running: boolean;
  cycleCount: number;
  lastAnalysisTime: number | null;
  lastTimelineHash: string | null;
  proposals: EditProposal[];
  sessionId: number | null;
  exampleCount: number;
}

export interface AgentSession {
  id?: number;
  sequenceId: string;
  sequenceName: string;
  startedAt: number;
  endedAt: number | null;
  cycleCount: number;
  proposalsGenerated: number;
  proposalsAccepted: number;
  proposalsRejected: number;
}
