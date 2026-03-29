import React, { useState, useCallback } from 'react';
import { c } from '../../styles.js';
import type { CuttingBoardAggregateStats, CuttingBoardSession } from '@mayday/types';
import { StatCard, Section } from './shared.js';
import { SessionRow } from './SessionRow.js';

export function CutWatcherTab({ stats, sessions, loaded, deleteSession, nameSession }: {
  stats: CuttingBoardAggregateStats | null;
  sessions: CuttingBoardSession[];
  loaded: boolean;
  deleteSession: (id: number) => Promise<void>;
  nameSession: (id: number, name: string) => Promise<void>;
}): React.ReactElement {
  const [pendingOp, setPendingOp] = useState<number | null>(null);

  const handleDelete = useCallback(async (id: number) => {
    setPendingOp(id);
    try { await deleteSession(id); } finally { setPendingOp(null); }
  }, [deleteSession]);

  const handleRename = useCallback(async (id: number, name: string) => {
    setPendingOp(id);
    try { await nameSession(id, name); } finally { setPendingOp(null); }
  }, [nameSession]);

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      {/* Summary stat cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
          <StatCard label="Total Edits" value={stats.totalEdits} />
          <StatCard label="Sessions" value={stats.totalSessions} />
          <StatCard
            label="Approval"
            value={stats.approvalRate != null ? `${Math.round(stats.approvalRate * 100)}%` : '—'}
            color={stats.approvalRate != null && stats.approvalRate >= 0.7 ? c.status.success : undefined}
          />
          <StatCard
            label="Tagged"
            value={Object.values(stats.tagCounts || {}).reduce((s, n) => s + n, 0)}
            color="#a855f7"
          />
          <StatCard
            label="Undo Rate"
            value={`${Math.round(stats.undoRate * 100)}%`}
            color={stats.undoRate > 0.15 ? c.status.error : c.text.primary}
          />
        </div>
      )}

      {/* Loading skeleton */}
      {!loaded && (
        <Section title="Sessions">
          <style>{shimmerKeyframes}</style>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{
              height: 36,
              borderRadius: 4,
              marginBottom: 6,
              background: `linear-gradient(90deg, ${c.bg.tertiary} 25%, ${c.bg.elevated} 50%, ${c.bg.tertiary} 75%)`,
              backgroundSize: '200% 100%',
              animation: 'shimmer 1.5s ease-in-out infinite',
            }} />
          ))}
        </Section>
      )}

      {/* Sessions list */}
      {loaded && sessions.length > 0 && (
        <Section title={`Sessions (${sessions.length})`}>
          <div style={{ maxHeight: 600, overflowY: 'auto', margin: '-4px -4px 0', padding: '0 4px' }}>
            {sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                loading={pendingOp === s.id}
                onDelete={handleDelete}
                onRename={handleRename}
              />
            ))}
          </div>
        </Section>
      )}

      {/* Empty state */}
      {loaded && sessions.length === 0 && (
        <Section title="Sessions">
          <div style={{ color: c.text.secondary, fontSize: 12 }}>
            No sessions yet. Start editing in Premiere Pro to capture your first session.
          </div>
        </Section>
      )}
    </div>
  );
}

const shimmerKeyframes = `
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;
