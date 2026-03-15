/** AI service types */

export interface AICompletionRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export interface AICompletionResponse {
  text: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason: string;
}

export interface AIStreamChunk {
  text: string;
  done: boolean;
}

export interface TimelineContext {
  sequenceName: string;
  duration: number;
  clipCount: number;
  tracks: {
    type: 'video' | 'audio';
    name: string;
    clipCount: number;
  }[];
  markers: {
    name: string;
    time: number;
  }[];
}
