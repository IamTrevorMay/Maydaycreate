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

const AUTO_DISMISS_MS = 5000;
const TAG_CONFIRM_MS = 800;

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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const dismissRef = useRef<ReturnType<typeof setTimeout>>();
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Subscribe to feedback requests
  useEffect(() => {
    const unsub = onMessage('plugin:cutting-board:feedback-request', (payload) => {
      const req = payload as FeedbackRequest;
      setQueue(q => [...q, req]);
    });
    return unsub;
  }, [onMessage]);

  // Show next item from queue
  useEffect(() => {
    if (!current && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrent(next);
      setQueue(rest);
      setSelectedTags([]);
      setDropdownOpen(false);
      setSubmitted(false);
    }
  }, [current, queue]);

  // Auto-dismiss timer — paused while dropdown is open
  useEffect(() => {
    if (!current || dropdownOpen) return;
    clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => {
      // If tags were selected, send them before dismissing
      if (selectedTags.length > 0 && !submitted) {
        sendTags(current.recordId, selectedTags);
      }
      setCurrent(null);
    }, AUTO_DISMISS_MS);
    return () => clearTimeout(dismissRef.current);
  }, [current, dropdownOpen, selectedTags, submitted]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  const sendTags = useCallback((recordId: number, tags: string[]) => {
    send({
      id: crypto.randomUUID(),
      type: 'plugin:cutting-board:set-tags',
      payload: { recordId, tags },
      timestamp: Date.now(),
    });
    setSubmitted(true);
  }, [send]);

  const toggleTag = useCallback((tagId: string) => {
    setSelectedTags(prev => {
      const next = prev.includes(tagId)
        ? prev.filter(t => t !== tagId)
        : [...prev, tagId];
      return next;
    });
  }, []);

  const confirmTags = useCallback(() => {
    if (!current) return;
    sendTags(current.recordId, selectedTags);
    setDropdownOpen(false);
    clearTimeout(dismissRef.current);
    dismissRef.current = setTimeout(() => setCurrent(null), TAG_CONFIRM_MS);
  }, [current, selectedTags, sendTags]);

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

      {/* Tag picker dropdown (replaces boost button) */}
      {!isUndo && (
        submitted ? (
          <span style={{ color: '#4ade80', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
            {selectedTags.length > 0
              ? INTENT_TAGS.filter(t => selectedTags.includes(t.id)).map(t => t.label).join(', ')
              : 'Tagged'}
          </span>
        ) : (
          <div ref={dropdownRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setDropdownOpen(o => !o)}
              style={{
                background: selectedTags.length > 0 ? '#1e3a5f' : '#2a2a3e',
                border: `1px solid ${selectedTags.length > 0 ? '#2680eb' : '#444'}`,
                borderRadius: 3,
                padding: '2px 8px',
                cursor: 'pointer',
                fontSize: 10,
                color: selectedTags.length > 0 ? '#93c5fd' : '#999',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {selectedTags.length > 0
                ? `${selectedTags.length} tag${selectedTags.length > 1 ? 's' : ''}`
                : 'Tag'}
              <span style={{ fontSize: 8 }}>{dropdownOpen ? '\u25B2' : '\u25BC'}</span>
            </button>

            {dropdownOpen && (
              <div style={{
                position: 'absolute',
                bottom: '100%',
                right: 0,
                marginBottom: 4,
                background: '#1e1e2e',
                border: '1px solid #444',
                borderRadius: 6,
                padding: 6,
                minWidth: 200,
                boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
                zIndex: 300,
              }}>
                {INTENT_TAGS.map(tag => {
                  const active = selectedTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      style={{
                        display: 'block',
                        width: '100%',
                        padding: '5px 8px',
                        background: active ? '#1e3a5f' : 'transparent',
                        border: 'none',
                        borderRadius: 3,
                        cursor: 'pointer',
                        fontSize: 11,
                        color: active ? '#93c5fd' : '#ccc',
                        fontWeight: active ? 600 : 400,
                        textAlign: 'left',
                        marginBottom: 2,
                      }}
                    >
                      {active ? '\u2713 ' : ''}{tag.label}
                    </button>
                  );
                })}

                {/* Confirm button */}
                <button
                  onClick={confirmTags}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '5px 8px',
                    marginTop: 4,
                    background: selectedTags.length > 0 ? '#2680eb' : '#333',
                    border: 'none',
                    borderRadius: 3,
                    cursor: selectedTags.length > 0 ? 'pointer' : 'default',
                    fontSize: 10,
                    color: selectedTags.length > 0 ? '#fff' : '#666',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {selectedTags.length > 0 ? 'Done' : 'Skip'}
                </button>
              </div>
            )}
          </div>
        )
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
