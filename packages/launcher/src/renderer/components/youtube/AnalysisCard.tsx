import React from 'react';
import { c } from '../../styles.js';
import type { VideoAnalysisSummary, AnalysisStatus } from '@mayday/types';

const STATUS_COLORS: Partial<Record<AnalysisStatus, string>> = {
  queued: c.text.secondary,
  downloading: c.accent.primary,
  extracting: c.accent.primary,
  analyzing: c.accent.primary,
  complete: c.status.success,
  error: c.status.error,
  cancelled: c.text.disabled,
};

interface AnalysisCardProps {
  analysis: VideoAnalysisSummary;
  onClick: () => void;
  onDelete: () => void;
}

export function AnalysisCard({ analysis, onClick, onDelete }: AnalysisCardProps): React.ReactElement {
  const formatDuration = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString();
    } catch {
      return iso;
    }
  };

  const thumbSrc = analysis.thumbnailPath
    ? `mayday-frame://${analysis.thumbnailPath}`
    : analysis.thumbnailUrl || '';

  return (
    <div
      onClick={onClick}
      style={{
        background: c.bg.elevated,
        borderRadius: 8,
        border: `1px solid ${c.border.default}`,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseOver={(e) => (e.currentTarget.style.borderColor = c.border.hover)}
      onMouseOut={(e) => (e.currentTarget.style.borderColor = c.border.default)}
    >
      {/* Thumbnail */}
      {thumbSrc && (
        <div style={{ position: 'relative' }}>
          <img
            src={thumbSrc}
            alt=""
            style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
          />
          <span style={{
            position: 'absolute',
            bottom: 4,
            right: 4,
            background: 'rgba(0,0,0,0.8)',
            color: '#fff',
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: 10,
          }}>
            {formatDuration(analysis.duration)}
          </span>
        </div>
      )}

      {/* Info */}
      <div style={{ padding: 10 }}>
        <div style={{
          color: c.text.primary,
          fontSize: 12,
          fontWeight: 600,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          marginBottom: 4,
        }}>
          {analysis.title}
        </div>
        <div style={{ color: c.text.secondary, fontSize: 11, marginBottom: 6 }}>
          {analysis.channel}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: STATUS_COLORS[analysis.status] || c.text.disabled,
              display: 'inline-block',
            }} />
            <span style={{ fontSize: 10, color: c.text.secondary }}>
              {analysis.status === 'complete' ? `${analysis.effectCount} effects` : analysis.status}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, color: c.text.disabled }}>
              {formatDate(analysis.createdAt)}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              style={{
                padding: '2px 6px',
                background: 'transparent',
                border: 'none',
                color: c.text.disabled,
                fontSize: 12,
                cursor: 'pointer',
              }}
              title="Delete"
            >
              x
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
