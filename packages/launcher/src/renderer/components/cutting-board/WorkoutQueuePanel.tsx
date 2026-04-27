import React from 'react';
import { c } from '../../styles.js';
import type { CuttingBoardTrainingDataSummary } from '@mayday/types';

const MIN_REPS = 30;

export function WorkoutQueuePanel({ summary }: {
  summary: CuttingBoardTrainingDataSummary | null;
}): React.ReactElement {
  if (!summary) {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>Workout Queue</div>
        <div style={{ color: c.text.disabled, fontSize: 11 }}>Loading...</div>
      </div>
    );
  }

  const needMore = summary.totalRecords < MIN_REPS;
  const remaining = MIN_REPS - summary.totalRecords;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Workout Queue</div>

      {/* Big number cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
        <BigNumber value={summary.untaggedCount} label="untagged cuts" color="#a855f7" />
        <BigNumber value={summary.unratedCount} label="unrated cuts" color="#fbbf24" />
        <BigNumber value={summary.totalRecords} label="total reps available" color={c.accent.primary} />
      </div>

      {/* Derived stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
        marginBottom: 14,
        padding: 8,
        background: c.bg.tertiary,
        borderRadius: 6,
      }}>
        <SmallStat label="Tagged" value={summary.taggedCount} />
        <SmallStat label="Rated" value={summary.ratedCount} />
        <SmallStat label="Boosted" value={summary.boostedCount} color="#fbbf24" />
        <SmallStat label="Marked Bad" value={summary.badCount} color="#f87171" />
      </div>

      {/* Minimum threshold */}
      {needMore && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: c.text.secondary }}>
              Need {remaining} more reps to train
            </span>
            <span style={{ fontSize: 10, color: c.text.disabled }}>
              {summary.totalRecords}/{MIN_REPS}
            </span>
          </div>
          <div style={{ height: 6, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${(summary.totalRecords / MIN_REPS) * 100}%`,
              background: c.accent.primary,
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {!needMore && (
        <div style={{ fontSize: 10, color: c.status.success, fontWeight: 600 }}>
          Ready to train!
        </div>
      )}

      {/* Sync status */}
      <div style={{ marginTop: 10, fontSize: 10, color: c.text.disabled, display: 'flex', alignItems: 'center', gap: 4 }}>
        {summary.unsyncedCount > 0 ? (
          <>
            <span style={{ color: c.status.warning }}>{'●'}</span>
            <span>{summary.unsyncedCount} record{summary.unsyncedCount !== 1 ? 's' : ''} pending sync</span>
          </>
        ) : (
          <>
            <span style={{ color: c.status.success }}>{'●'}</span>
            <span>All records synced to cloud</span>
          </>
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: c.bg.elevated,
  borderRadius: 8,
  border: `1px solid ${c.border.default}`,
  padding: 16,
};

const headerStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: c.text.primary,
  marginBottom: 14,
};

function BigNumber({ value, label, color }: { value: number; label: string; color: string }): React.ReactElement {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'baseline',
      gap: 8,
      padding: '8px 10px',
      background: color + '11',
      borderRadius: 6,
      border: `1px solid ${color}22`,
    }}>
      <span style={{ fontSize: 24, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 11, color: c.text.secondary }}>{label}</span>
    </div>
  );
}

function SmallStat({ label, value, color }: { label: string; value: number; color?: string }): React.ReactElement {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: c.text.disabled }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color || c.text.primary }}>{value}</span>
    </div>
  );
}
