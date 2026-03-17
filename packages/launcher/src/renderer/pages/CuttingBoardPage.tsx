import React from 'react';
import { c } from '../styles.js';
import { useCuttingBoard } from '../hooks/useCuttingBoard.js';

const EDIT_TYPE_COLORS: Record<string, string> = {
  cut: '#2680eb',
  'trim-head': '#a855f7',
  'trim-tail': '#ec4899',
  delete: '#f87171',
  move: '#fbbf24',
  add: '#4ade80',
};

export function CuttingBoardPage(): React.ReactElement {
  const { stats, trainingRuns, training, trainModel } = useCuttingBoard();

  if (!stats) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: c.text.secondary, fontSize: 13, marginBottom: 8 }}>
          No data yet.
        </div>
        <div style={{ color: c.text.disabled, fontSize: 12 }}>
          Use Cutting Board in Premiere Pro to start recording edits.
        </div>
      </div>
    );
  }

  const maxTypeCount = Math.max(1, ...Object.values(stats.editsByType));
  const latestRun = trainingRuns[0] ?? null;

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="Total Edits" value={stats.totalEdits} />
        <StatCard label="Sessions" value={stats.totalSessions} />
        <StatCard label="Approval" value={stats.approvalRate != null ? `${Math.round(stats.approvalRate * 100)}%` : '—'} color={stats.approvalRate != null && stats.approvalRate >= 0.7 ? c.status.success : undefined} />
        <StatCard label="Boosted" value={stats.boostedCount} color="#a855f7" />
        <StatCard label="Undo Rate" value={`${Math.round(stats.undoRate * 100)}%`} color={stats.undoRate > 0.15 ? c.status.error : c.text.primary} />
      </div>

      {/* Edit type breakdown */}
      {Object.keys(stats.editsByType).length > 0 && (
        <Section title="Edit Type Breakdown">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(stats.editsByType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 70, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{type}</span>
                  <div style={{ flex: 1, height: 18, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(count / maxTypeCount) * 100}%`,
                      background: EDIT_TYPE_COLORS[type] || c.accent.primary,
                      borderRadius: 3,
                      minWidth: 4,
                    }} />
                  </div>
                  <span style={{ width: 32, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{count}</span>
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* Approval bar */}
      {(stats.thumbsUp > 0 || stats.thumbsDown > 0) && (
        <Section title="Approval">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: c.status.success }}>+{stats.thumbsUp}</span>
            <div style={{ flex: 1, height: 14, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              <div style={{ height: '100%', width: `${(stats.thumbsUp / (stats.thumbsUp + stats.thumbsDown)) * 100}%`, background: c.status.success }} />
              <div style={{ height: '100%', flex: 1, background: c.status.error }} />
            </div>
            <span style={{ fontSize: 12, color: c.status.error }}>-{stats.thumbsDown}</span>
          </div>
        </Section>
      )}

      {/* Recent sessions */}
      {stats.recentSessions.length > 0 && (
        <Section title="Recent Sessions">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: c.text.secondary, textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Sequence</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Edits</th>
                <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Approval</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSessions.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${c.border.default}` }}>
                  <td style={{ padding: '6px 8px', color: c.text.primary }}>{s.sequenceName}</td>
                  <td style={{ padding: '6px 8px', color: c.text.secondary }}>{new Date(s.startedAt).toLocaleDateString()}</td>
                  <td style={{ padding: '6px 8px', color: c.text.primary, textAlign: 'right' }}>{s.totalEdits}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: s.approvalRate != null && s.approvalRate >= 0.7 ? c.status.success : c.text.secondary }}>
                    {s.approvalRate != null ? `${Math.round(s.approvalRate * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Model training */}
      <Section title="Model Training">
        {latestRun ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <MiniStat label="Version" value={`v${latestRun.version}`} />
            <MiniStat label="Accuracy" value={`${Math.round(latestRun.accuracy * 100)}%`} color={latestRun.accuracy >= 0.7 ? c.status.success : c.status.warning} />
            <MiniStat label="Training Size" value={latestRun.trainingSize} />
            <MiniStat label="Trained" value={formatRelativeTime(latestRun.trainedAt)} />
          </div>
        ) : (
          <div style={{ color: c.text.secondary, fontSize: 12, marginBottom: 12 }}>No model trained yet.</div>
        )}

        <button
          onClick={trainModel}
          disabled={training}
          style={{
            padding: '8px 20px',
            background: training ? c.bg.tertiary : c.accent.primary,
            color: training ? c.text.disabled : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: training ? 'default' : 'pointer',
            marginBottom: 16,
          }}
        >
          {training ? 'Training...' : 'Train Model'}
        </button>

        {/* Training runs history */}
        {trainingRuns.length > 0 && (
          <div>
            <div style={{ color: c.text.secondary, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>History</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: c.text.secondary, textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Version</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Size</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {trainingRuns.map(run => (
                  <tr key={run.id} style={{ borderTop: `1px solid ${c.border.default}` }}>
                    <td style={{ padding: '6px 8px', color: c.text.primary }}>v{run.version}</td>
                    <td style={{ padding: '6px 8px', color: c.text.secondary }}>{new Date(run.trainedAt).toLocaleDateString()}</td>
                    <td style={{ padding: '6px 8px', color: c.text.primary, textAlign: 'right' }}>{run.trainingSize}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: run.accuracy >= 0.7 ? c.status.success : c.status.warning }}>
                      {Math.round(run.accuracy * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      padding: 14,
      border: `1px solid ${c.border.default}`,
      textAlign: 'center',
    }}>
      <div style={{ color: color || c.text.primary, fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: color || c.text.primary, fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${c.border.default}`,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ color: c.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
