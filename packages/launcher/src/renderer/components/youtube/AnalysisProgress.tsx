import React from 'react';
import { c } from '../../styles.js';
import type { AnalysisProgress as ProgressType } from '@mayday/types';

const PHASES = ['downloading', 'extracting', 'analyzing', 'complete'] as const;
const PHASE_LABELS: Record<string, string> = {
  downloading: 'Downloading',
  extracting: 'Extracting',
  analyzing: 'Analyzing',
  complete: 'Complete',
};

interface AnalysisProgressProps {
  progress: ProgressType;
  onCancel: () => void;
}

export function AnalysisProgress({ progress, onCancel }: AnalysisProgressProps): React.ReactElement {
  const currentPhaseIdx = PHASES.indexOf(progress.status as typeof PHASES[number]);
  const isTerminal = progress.status === 'complete' || progress.status === 'error' || progress.status === 'cancelled';

  return (
    <div style={{
      padding: 20,
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${c.border.default}`,
      margin: '0 20px 20px',
    }}>
      {/* Phase indicators */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {PHASES.map((phase, i) => {
          const isActive = phase === progress.status;
          const isDone = currentPhaseIdx > i || progress.status === 'complete';
          return (
            <div key={phase} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: isDone ? c.status.success : isActive ? c.accent.primary : c.bg.tertiary,
                marginBottom: 6,
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: 10,
                color: isActive ? c.text.primary : isDone ? c.status.success : c.text.disabled,
                fontWeight: isActive ? 600 : 400,
              }}>
                {PHASE_LABELS[phase] || phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {!isTerminal && (
        <div style={{ marginBottom: 12 }}>
          <div style={{
            height: 6,
            background: c.bg.tertiary,
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${progress.percent}%`,
              background: c.accent.primary,
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* Detail + cancel */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: c.text.secondary, fontSize: 12 }}>
          {progress.detail}
        </span>
        {!isTerminal && (
          <button
            onClick={onCancel}
            style={{
              padding: '4px 12px',
              background: 'transparent',
              border: `1px solid ${c.status.error}`,
              color: c.status.error,
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        )}
        {progress.status === 'error' && (
          <span style={{ color: c.status.error, fontSize: 12, fontWeight: 600 }}>Failed</span>
        )}
        {progress.status === 'complete' && (
          <span style={{ color: c.status.success, fontSize: 12, fontWeight: 600 }}>Done</span>
        )}
      </div>
    </div>
  );
}
