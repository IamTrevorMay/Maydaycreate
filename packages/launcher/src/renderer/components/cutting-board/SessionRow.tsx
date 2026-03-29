import React, { useState, useCallback, useRef, useEffect } from 'react';
import { c } from '../../styles.js';
import type { CuttingBoardSession } from '@mayday/types';
import { EDIT_TYPE_COLORS, formatRelativeTime } from './shared.js';

export function SessionRow({ session, loading, onDelete, onRename }: {
  session: CuttingBoardSession;
  loading?: boolean;
  onDelete: (id: number) => void;
  onRename: (id: number, name: string) => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const isLive = session.endedAt === null;
  const displayName = session.sessionName || session.sequenceName;

  const startRename = useCallback(() => {
    setEditValue(session.sessionName || session.sequenceName);
    setEditing(true);
  }, [session]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== (session.sessionName || '')) {
      onRename(session.id, trimmed);
    }
    setEditing(false);
  }, [editValue, session, onRename]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLive) return;
    if (confirm(`Delete session "${displayName}" and all its cut records?`)) {
      onDelete(session.id);
    }
  }, [session, displayName, isLive, onDelete]);

  // Compute approval rate from session data (cuts with tags / total cuts as proxy)
  const approvalPct = session.totalEdits > 0 && session.cutCount > 0
    ? Math.round((session.taggedCount / session.cutCount) * 100)
    : null;

  return (
    <div style={{
      borderBottom: `1px solid ${c.border.default}`,
      transition: 'background 0.15s',
      opacity: loading ? 0.5 : 1,
      pointerEvents: loading ? 'none' : 'auto',
      position: 'relative',
    }}>
      {/* Collapsed row */}
      <div
        onClick={() => !editing && setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
        }}
      >
        {/* Expand arrow */}
        <span style={{ fontSize: 10, color: c.text.disabled, width: 12, flexShrink: 0 }}>
          {expanded ? '\u25BC' : '\u25B6'}
        </span>

        {/* Live indicator */}
        {isLive && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 9,
            fontWeight: 700,
            color: '#4ade80',
            flexShrink: 0,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', background: '#4ade80',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            Live
          </span>
        )}

        {/* Session name (double-click to rename) */}
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={commitRename}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1,
              padding: '2px 6px',
              background: c.bg.tertiary,
              border: `1px solid ${c.accent.primary}`,
              borderRadius: 3,
              color: c.text.primary,
              fontSize: 12,
              fontWeight: 600,
              outline: 'none',
            }}
          />
        ) : (
          <span
            onDoubleClick={e => { e.stopPropagation(); startRename(); }}
            style={{
              flex: 1,
              fontSize: 12,
              fontWeight: 600,
              color: c.text.primary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title="Double-click to rename"
          >
            {displayName}
          </span>
        )}

        {/* Edit count badge */}
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 8px',
          borderRadius: 10,
          background: session.totalEdits > 0 ? c.accent.primary + '22' : c.bg.tertiary,
          color: session.totalEdits > 0 ? c.accent.primary : c.text.disabled,
          flexShrink: 0,
        }}>
          {session.totalEdits} edits
        </span>

        {/* Date */}
        <span style={{ fontSize: 10, color: c.text.disabled, flexShrink: 0, width: 50, textAlign: 'right' }}>
          {formatRelativeTime(session.startedAt)}
        </span>

        {/* Approval / tagged rate */}
        {approvalPct !== null && (
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            color: approvalPct >= 70 ? '#4ade80' : approvalPct >= 50 ? '#fbbf24' : '#f87171',
            flexShrink: 0,
            width: 36,
            textAlign: 'right',
          }}>
            {approvalPct}%
          </span>
        )}

        {/* Delete button (hover visible via CSS, always in DOM) */}
        {!isLive && (
          <button
            onClick={handleDelete}
            style={{
              background: 'none',
              border: 'none',
              color: c.text.secondary,
              cursor: 'pointer',
              fontSize: 12,
              padding: '0 4px',
              lineHeight: 1,
              opacity: 0.6,
              transition: 'opacity 0.15s',
              flexShrink: 0,
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
            title="Delete session"
          >
            {'\u2715'}
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '0 12px 12px 32px' }}>
          {/* Stats row */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            <MiniDetail label="Total Edits" value={session.totalEdits} />
            <MiniDetail label="Cuts" value={session.cutCount} />
            <MiniDetail label="Tagged" value={session.taggedCount} color="#a855f7" />
            {session.endedAt && (
              <MiniDetail
                label="Duration"
                value={formatDuration(session.endedAt - session.startedAt)}
              />
            )}
            <MiniDetail
              label="Started"
              value={new Date(session.startedAt).toLocaleDateString()}
            />
          </div>

          {/* Cut count bar (if there are cuts) */}
          {session.cutCount > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: c.text.secondary, marginBottom: 4 }}>Cuts vs Other Edits</div>
              <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${(session.cutCount / Math.max(1, session.totalEdits + session.cutCount)) * 100}%`,
                  background: EDIT_TYPE_COLORS.cut,
                  minWidth: 4,
                }} />
                <div style={{
                  flex: 1,
                  background: c.bg.tertiary,
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ fontSize: 9, color: c.text.disabled }}>{session.cutCount} cuts</span>
                <span style={{ fontSize: 9, color: c.text.disabled }}>{session.totalEdits} other</span>
              </div>
            </div>
          )}

          {/* Tagged bar */}
          {session.cutCount > 0 && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: c.text.secondary, marginBottom: 4 }}>Tagged Coverage</div>
              <div style={{ display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${(session.taggedCount / Math.max(1, session.cutCount)) * 100}%`,
                  background: '#a855f7',
                  minWidth: session.taggedCount > 0 ? 4 : 0,
                }} />
                <div style={{ flex: 1, background: c.bg.tertiary }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                <span style={{ fontSize: 9, color: c.text.disabled }}>{session.taggedCount} tagged</span>
                <span style={{ fontSize: 9, color: c.text.disabled }}>{session.cutCount - session.taggedCount} untagged</span>
              </div>
            </div>
          )}

          {session.totalEdits === 0 && session.cutCount === 0 && (
            <div style={{ fontSize: 11, color: c.text.disabled }}>No edit data recorded in this session.</div>
          )}
        </div>
      )}
    </div>
  );
}

function MiniDetail({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: color || c.text.primary }}>{value}</div>
      <div style={{ fontSize: 9, color: c.text.disabled }}>{label}</div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}
