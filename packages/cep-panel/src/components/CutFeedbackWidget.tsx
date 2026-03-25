import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';
import { INTENT_TAGS } from '@mayday/types';

interface FeedbackRequest {
  recordId: number;
  editType: string;
  clipName: string;
  editPointTime: number;
  trackType: string;
  isUndo: boolean;
}

interface CutFeedbackWidgetProps {
  onMessage: (type: string, callback: (payload: unknown) => void) => () => void;
  send: (message: BridgeMessage) => void;
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const f = Math.floor((seconds % 1) * 30);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
}

const editTypeLabels: Record<string, string> = {
  'cut': 'Cut',
  'trim-head': 'Trim Head',
  'trim-tail': 'Trim Tail',
  'delete': 'Delete',
  'move': 'Move',
  'add': 'Add',
};

export function CutFeedbackWidget({ onMessage, send }: CutFeedbackWidgetProps) {
  const [queue, setQueue] = useState<FeedbackRequest[]>([]);
  const [current, setCurrent] = useState<FeedbackRequest | null>(null);
  const [appliedTags, setAppliedTags] = useState<string[]>([]);
  const [autoDismissMs, setAutoDismissMs] = useState(8000);
  const dismissRef = useRef<ReturnType<typeof setTimeout>>();

  // Fetch auto-dismiss setting on mount
  useEffect(() => {
    send({
      id: crypto.randomUUID(),
      type: 'cutting-board:get-auto-dismiss' as any,
      payload: {},
      timestamp: Date.now(),
    });
    const unsub = onMessage('cutting-board:auto-dismiss-data', (payload) => {
      const data = payload as { ms: number };
      setAutoDismissMs(data.ms);
    });
    return unsub;
  }, [onMessage, send]);

  // Subscribe to feedback requests
  useEffect(() => {
    const unsub = onMessage('plugin:cutting-board:feedback-request', (payload) => {
      const req = payload as FeedbackRequest;
      setQueue(q => [req, ...q]);
    });
    return unsub;
  }, [onMessage]);

  // Show next item from queue
  useEffect(() => {
    if (!current && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setAppliedTags([]);
    }
  }, [current, queue]);

  // Auto-dismiss timer — resets when tags change
  useEffect(() => {
    if (!current) return;
    clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => {
      setCurrent(null);
    }, autoDismissMs);
    return () => clearTimeout(dismissRef.current);
  }, [current, appliedTags, autoDismissMs]);

  const toggleTag = useCallback((tagId: string) => {
    if (!current) return;
    const next = appliedTags.includes(tagId)
      ? appliedTags.filter(t => t !== tagId)
      : [...appliedTags, tagId];
    setAppliedTags(next);
    send({
      id: crypto.randomUUID(),
      type: 'plugin:cutting-board:set-tags',
      payload: { recordId: current.recordId, tags: next },
      timestamp: Date.now(),
    });
  }, [current, appliedTags, send]);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const seconds = Number(e.target.value);
    const ms = seconds * 1000;
    setAutoDismissMs(ms);
    send({
      id: crypto.randomUUID(),
      type: 'cutting-board:set-auto-dismiss' as any,
      payload: { ms },
      timestamp: Date.now(),
    });
  }, [send]);

  if (!current) return null;

  const isUndo = current.isUndo;

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      background: isUndo ? '#3a2020' : '#1a1a2e',
      borderTop: `2px solid ${isUndo ? '#f87171' : '#2680eb'}`,
      padding: '8px 12px 6px',
      zIndex: 200,
      fontSize: 11,
    }}>
      {/* Top row: edit info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 16 }}>
          {isUndo ? '\uD83D\uDC4E' : '\uD83D\uDC4D'}
        </span>

        <span style={{
          background: isUndo ? '#7f1d1d' : '#1e3a5f',
          color: isUndo ? '#fca5a5' : '#93c5fd',
          padding: '2px 6px',
          borderRadius: 3,
          fontWeight: 600,
          fontSize: 10,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }}>
          {isUndo ? 'Undo' : editTypeLabels[current.editType] || current.editType}
        </span>

        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{current.clipName}</span>
          <span style={{ color: '#64748b', marginLeft: 6 }}>
            @ {formatTimecode(current.editPointTime)}
          </span>
        </div>

        {/* Queue indicator */}
        {queue.length > 0 && (
          <span style={{
            background: '#2680eb',
            color: '#fff',
            borderRadius: '50%',
            width: 16, height: 16,
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {queue.length}
          </span>
        )}
      </div>

      {/* Tag buttons row */}
      {!isUndo && (
        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
          {INTENT_TAGS.map(tag => {
            const active = appliedTags.includes(tag.id);
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                style={{
                  background: active ? '#1e3a5f' : '#2a2a3e',
                  border: `1px solid ${active ? '#2680eb' : '#383848'}`,
                  borderRadius: 12,
                  padding: '3px 10px',
                  cursor: 'pointer',
                  fontSize: 10,
                  color: active ? '#93c5fd' : '#888',
                  fontWeight: active ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Auto-submit timer slider */}
      {!isUndo && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 5,
          fontSize: 10,
          color: '#666',
        }}>
          <span>Auto-submit:</span>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={autoDismissMs / 1000}
            onChange={handleSliderChange}
            style={{ flex: 1, height: 4, cursor: 'pointer' }}
          />
          <span style={{ minWidth: 24, textAlign: 'right' }}>{(autoDismissMs / 1000).toFixed(1)}s</span>
        </div>
      )}
    </div>
  );
}
