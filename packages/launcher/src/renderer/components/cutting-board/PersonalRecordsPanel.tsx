import React from 'react';
import { c } from '../../styles.js';
import { MiniStat, formatRelativeTime } from './shared.js';
import type { CuttingBoardTrainingRun, CloudTrainingRun } from '@mayday/types';

export function PersonalRecordsPanel({ trainingRuns, cloudRegistry, machineId }: {
  trainingRuns: CuttingBoardTrainingRun[];
  cloudRegistry: CloudTrainingRun[];
  machineId: string;
}): React.ReactElement {
  const hasCloud = cloudRegistry.length > 0;
  const bestCloud = cloudRegistry.find(r => r.isBest) ?? cloudRegistry[0] ?? null;
  const latestRun = trainingRuns[0] ?? null;

  // Use best cloud model for summary stats if available, else fall back to local
  const summaryVersion = hasCloud ? bestCloud!.version : latestRun?.version;
  const summaryAccuracy = hasCloud ? bestCloud!.accuracy : latestRun?.accuracy;
  const summaryReps = hasCloud ? bestCloud!.trainingSize : latestRun?.trainingSize;
  const summaryDate = hasCloud ? bestCloud!.trainedAt : latestRun?.trainedAt;
  const hasSummary = summaryVersion != null;

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>Personal Records</div>

      {hasSummary ? (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <MiniStat label="Version" value={`v${summaryVersion}`} />
            <MiniStat
              label="Accuracy"
              value={`${Math.round(summaryAccuracy! * 100)}%`}
              color={summaryAccuracy! >= 0.7 ? c.status.success : summaryAccuracy! >= 0.5 ? c.status.warning : c.status.error}
            />
            <MiniStat label="Training Reps" value={summaryReps!} />
            <MiniStat label="Last Session" value={formatRelativeTime(summaryDate!)} />
          </div>

          {/* Cloud table (all machines) */}
          {hasCloud ? (
            <div>
              <div style={{ fontSize: 10, color: c.text.secondary, fontWeight: 600, marginBottom: 6 }}>All Machines</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ color: c.text.disabled, textAlign: 'left' }}>
                    <th style={{ padding: '3px 6px', fontWeight: 600 }}>Machine</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600 }}>Ver</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600 }}>Date</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600, textAlign: 'right' }}>Reps</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600, textAlign: 'right' }}>Acc</th>
                  </tr>
                </thead>
                <tbody>
                  {cloudRegistry.map(run => {
                    const isMe = run.machineId === machineId;
                    return (
                    <tr key={run.id} style={{
                      borderTop: `1px solid ${c.border.default}`,
                      background: run.isBest ? '#4ade8012' : isMe ? '#60a5fa08' : undefined,
                    }}>
                      <td style={{ padding: '4px 6px', color: isMe ? c.accent.primary : c.text.primary, fontWeight: isMe ? 600 : 400 }}>
                        {run.isBest ? '\u2B50 ' : ''}{run.machineName}{isMe ? ' (You)' : ''}
                      </td>
                      <td style={{ padding: '4px 6px', color: c.text.primary }}>v{run.version}</td>
                      <td style={{ padding: '4px 6px', color: c.text.secondary }}>{new Date(run.trainedAt).toLocaleDateString()}</td>
                      <td style={{ padding: '4px 6px', color: c.text.primary, textAlign: 'right' }}>{run.trainingSize}</td>
                      <td style={{
                        padding: '4px 6px',
                        textAlign: 'right',
                        fontWeight: run.isBest ? 700 : 400,
                        color: run.accuracy >= 0.7 ? c.status.success : run.accuracy >= 0.5 ? c.status.warning : c.status.error,
                      }}>
                        {Math.round(run.accuracy * 100)}%
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Local-only table (Supabase not configured) */
            <div>
              <div style={{ fontSize: 10, color: c.text.secondary, fontWeight: 600, marginBottom: 6 }}>History</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ color: c.text.disabled, textAlign: 'left' }}>
                    <th style={{ padding: '3px 6px', fontWeight: 600 }}>Ver</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600 }}>Date</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600, textAlign: 'right' }}>Reps</th>
                    <th style={{ padding: '3px 6px', fontWeight: 600, textAlign: 'right' }}>Acc</th>
                  </tr>
                </thead>
                <tbody>
                  {trainingRuns.map(run => (
                    <tr key={run.id} style={{ borderTop: `1px solid ${c.border.default}` }}>
                      <td style={{ padding: '4px 6px', color: c.text.primary }}>v{run.version}</td>
                      <td style={{ padding: '4px 6px', color: c.text.secondary }}>{new Date(run.trainedAt).toLocaleDateString()}</td>
                      <td style={{ padding: '4px 6px', color: c.text.primary, textAlign: 'right' }}>{run.trainingSize}</td>
                      <td style={{
                        padding: '4px 6px',
                        textAlign: 'right',
                        color: run.accuracy >= 0.7 ? c.status.success : run.accuracy >= 0.5 ? c.status.warning : c.status.error,
                      }}>
                        {Math.round(run.accuracy * 100)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div style={{ color: c.text.disabled, fontSize: 11, lineHeight: 1.5 }}>
          No training sessions yet. Collect at least 30 reps, then hit the gym!
        </div>
      )}
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
