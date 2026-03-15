import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { BridgeMessage } from '@mayday/types';

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

const AUTO_DISMISS_MS = 5000;
const BOOST_FLASH_MS = 800;

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
  const [boosted, setBoosted] = useState(false);
  const dismissRef = useRef<ReturnType<typeof setTimeout>>();

  // Subscribe to feedback requests
  useEffect(() => {
    const unsub = onMessage('plugin:cutting-board:feedback-request', (payload) => {
      const req = payload as FeedbackRequest;
      setQueue(q => [...q, req]);
    });
    return unsub;
  }, [onMessage]);

  // Subscribe to server-side hotkey boost
  useEffect(() => {
    const unsub = onMessage('plugin:cutting-board:hotkey-boost', (payload) => {
      const { recordId } = payload as { recordId: number };
      if (current && current.recordId === recordId) {
        setBoosted(true);
        clearTimeout(dismissRef.current);
        dismissRef.current = setTimeout(() => setCurrent(null), BOOST_FLASH_MS);
      }
    });
    return unsub;
  }, [onMessage, current]);

  // Show next item from queue
  useEffect(() => {
    if (!current && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setBoosted(false);
    }
  }, [current, queue]);

  // Auto-dismiss timer
  useEffect(() => {
    if (!current) return;
    clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => {
      setCurrent(null);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(dismissRef.current);
  }, [current]);

  const boost = useCallback(() => {
    if (!current || current.isUndo) return;
    setBoosted(true);
    send({
      id: crypto.randomUUID(),
      type: 'plugin:cutting-board:boost',
      payload: { recordId: current.recordId },
      timestamp: Date.now(),
    });
    clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => setCurrent(null), BOOST_FLASH_MS);
  }, [current, send]);

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
      padding: '8px 12px',
      zIndex: 200,
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      fontSize: 11,
    }}>
      {/* Thumbs emoji */}
      <span style={{ fontSize: 16 }}>
        {isUndo ? '\uD83D\uDC4E' : '\uD83D\uDC4D'}
      </span>

      {/* Edit type badge */}
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

      {/* Clip info */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{current.clipName}</span>
        <span style={{ color: '#64748b', marginLeft: 6 }}>
          @ {formatTimecode(current.editPointTime)}
        </span>
      </div>

      {/* Boost button or boosted confirmation */}
      {boosted ? (
        <span style={{ color: '#fbbf24', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {'\u2B50'} Boosted!
        </span>
      ) : !isUndo ? (
        <button
          onClick={boost}
          style={{
            background: '#1e3a5f',
            border: '1px solid #2680eb',
            borderRadius: 3,
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: 10,
            color: '#93c5fd',
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          title="Boost this edit (B)"
        >
          {'\u2B50'} Boost
        </button>
      ) : null}

      {/* Hint */}
      {!isUndo && !boosted && (
        <span style={{ color: '#475569', fontSize: 9, whiteSpace: 'nowrap' }}>
          B to boost
        </span>
      )}

      {/* Queue indicator */}
      {queue.length > 0 && (
        <span style={{
          position: 'absolute',
          top: -8,
          right: 8,
          background: '#2680eb',
          color: '#fff',
          borderRadius: '50%',
          width: 16, height: 16,
          fontSize: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 600,
        }}>
          {queue.length}
        </span>
      )}
    </div>
  );
}
