import React from 'react';
import { c } from '../../styles.js';
import type { AnalysisProgress as ProgressType } from '@mayday/types';

const PHASES = ['downloading', 'extracting', 'analyzing', 'complete'] as const;
const PHASE_LABELS: Record<string, string> = {
  downloading: 'Downloading',
  extracting: 'Extracting',
  analyzing: 'Analyzing',
  paused: 'Paused',
  complete: 'Complete',
};

interface AnalysisProgressProps {
  progress: ProgressType;
  onCancel: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export function AnalysisProgress({ progress, onCancel, onPause, onResume }: AnalysisProgressProps): React.ReactElement {
  const isPaused = progress.status === 'paused';
  const isTerminal = progress.status === 'complete' || progress.status === 'error' || progress.status === 'cancelled';
  const isRunning = !isTerminal && !isPaused;

  const currentPhaseIdx = PHASES.indexOf(progress.status as typeof PHASES[number]);

  return (
    <div style={{
      padding: 20,
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${isPaused ? c.status.warning : c.border.default}`,
      margin: '0 20px 20px',
    }}>
      {/* Phase indicators */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {PHASES.map((phase, i) => {
          const isActive = phase === progress.status || (isPaused && phase === 'analyzing');
          const isDone = currentPhaseIdx > i || progress.status === 'complete';
          return (
            <div key={phase} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{
                height: 4,
                borderRadius: 2,
                background: isDone ? c.status.success : isActive ? (isPaused ? c.status.warning : c.accent.primary) : c.bg.tertiary,
                marginBottom: 6,
                transition: 'background 0.3s',
              }} />
              <span style={{
                fontSize: 10,
                color: isActive ? c.text.primary : isDone ? c.status.success : c.text.disabled,
                fontWeight: isActive ? 600 : 400,
              }}>
                {isPaused && phase === 'analyzing' ? 'Paused' : PHASE_LABELS[phase] || phase}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      {(isRunning || isPaused) && (
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
              background: isPaused ? c.status.warning : c.accent.primary,
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {/* Detail + controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: isPaused ? c.status.warning : c.text.secondary, fontSize: 12 }}>
          {progress.detail}
        </span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isRunning && onPause && (
            <button
              onClick={onPause}
              style={{
                padding: '6px 18px',
                background: '#fbbf24',
                border: 'none',
                color: '#000',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              PAUSE
            </button>
          )}
          {isPaused && onResume && (
            <button
              onClick={() => onResume()}
              style={{
                padding: '4px 12px',
                background: c.accent.primary,
                border: 'none',
                color: '#fff',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Resume
            </button>
          )}
          {(isRunning || isPaused) && (
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
    </div>
  );
}
