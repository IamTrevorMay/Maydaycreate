import type { EditProposal, ProposedAction, ProposedActionType } from './types.js';

const VALID_EDIT_TYPES: ProposedActionType[] = ['split', 'trim-head', 'trim-tail', 'delete', 'insert', 'move', 'enable', 'disable'];

export function parseResponse(responseText: string, sessionId: number): EditProposal[] {
  // Extract JSON array from response (Claude might wrap in markdown code blocks)
  const jsonStr = extractJSON(responseText);
  if (!jsonStr) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const proposals: EditProposal[] = [];
  const now = Date.now();

  for (const item of parsed) {
    const proposal = validateProposal(item, sessionId, now);
    if (proposal) proposals.push(proposal);
  }

  return proposals;
}

function extractJSON(text: string): string | null {
  // Try raw parse first
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) return trimmed;

  // Extract from markdown code block
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();

  // Find first [ ... ] in text
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

  return null;
}

function validateProposal(item: any, sessionId: number, timestamp: number): EditProposal | null {
  if (!item || typeof item !== 'object') return null;

  const editType = item.editType as ProposedActionType;
  if (!VALID_EDIT_TYPES.includes(editType)) return null;

  const confidence = typeof item.confidence === 'number'
    ? Math.max(0, Math.min(1, item.confidence))
    : 0.5;

  const description = typeof item.description === 'string' ? item.description : `${editType} edit`;
  const reasoning = typeof item.reasoning === 'string' ? item.reasoning : '';

  const trackIndex = typeof item.trackIndex === 'number' ? item.trackIndex : 0;
  const trackType = item.trackType === 'audio' ? 'audio' as const : 'video' as const;
  const clipIndex = typeof item.clipIndex === 'number' ? item.clipIndex : 0;

  const params = item.params && typeof item.params === 'object' ? item.params : {};

  const action: ProposedAction = {
    type: editType,
    trackIndex,
    trackType,
    clipIndex,
    params: {
      splitTime: typeof params.splitTime === 'number' ? params.splitTime : undefined,
      newInPoint: typeof params.newInPoint === 'number' ? params.newInPoint : undefined,
      newOutPoint: typeof params.newOutPoint === 'number' ? params.newOutPoint : undefined,
      ripple: typeof params.ripple === 'boolean' ? params.ripple : undefined,
      insertTime: typeof params.insertTime === 'number' ? params.insertTime : undefined,
      projectItemPath: typeof params.projectItemPath === 'string' ? params.projectItemPath : undefined,
      moveToTime: typeof params.moveToTime === 'number' ? params.moveToTime : undefined,
      enabled: typeof params.enabled === 'boolean' ? params.enabled : undefined,
    },
  };

  return {
    id: 0, // assigned by DB
    editType,
    description,
    confidence,
    reasoning,
    action,
    status: 'pending',
    createdAt: timestamp,
    executedAt: null,
    sessionId,
  };
}
