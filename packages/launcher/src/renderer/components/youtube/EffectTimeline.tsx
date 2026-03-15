import React from 'react';
import { c } from '../../styles.js';
import type { DetectedEffect, EffectCategory } from '@mayday/types';

const CATEGORY_COLORS: Partial<Record<EffectCategory, string>> = {
  cut: '#f87171',
  transition: '#60a5fa',
  'color-grade': '#fbbf24',
  'text-overlay': '#a78bfa',
  blur: '#94a3b8',
  scale: '#34d399',
  opacity: '#67e8f9',
  'speed-ramp': '#fb923c',
  mask: '#e879f9',
  composite: '#818cf8',
  'motion-graphics': '#2dd4bf',
  other: '#6b7280',
};

interface EffectTimelineProps {
  effects: DetectedEffect[];
  duration: number;
  selectedId: string | null;
  onSelect: (effect: DetectedEffect) => void;
}

export function EffectTimeline({ effects, duration, selectedId, onSelect }: EffectTimelineProps): React.ReactElement {
  if (duration <= 0) return <div />;

  const timeToPercent = (time: number) => (time / duration) * 100;

  return (
    <div style={{
      padding: '12px 20px',
      background: c.bg.secondary,
      borderBottom: `1px solid ${c.border.default}`,
    }}>
      <div style={{ fontSize: 11, color: c.text.secondary, marginBottom: 6 }}>
        Timeline ({effects.length} effects)
      </div>
      <div style={{
        position: 'relative',
        height: 40,
        background: c.bg.elevated,
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'default',
      }}>
        {/* Time rulers */}
        {Array.from({ length: Math.min(Math.ceil(duration / 10), 30) }, (_, i) => {
          const time = (i + 1) * 10;
          if (time >= duration) return null;
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${timeToPercent(time)}%`,
              top: 0,
              bottom: 0,
              width: 1,
              background: c.border.default,
            }}>
              <span style={{
                position: 'absolute',
                top: 2,
                left: 3,
                fontSize: 8,
                color: c.text.disabled,
              }}>
                {time}s
              </span>
            </div>
          );
        })}

        {/* Effect markers */}
        {effects.map(effect => {
          const left = timeToPercent(effect.startTime);
          const width = Math.max(timeToPercent(effect.endTime - effect.startTime), 0.5);
          const isSelected = effect.id === selectedId;
          const isUnrated = effect.rating == null;
          const color = CATEGORY_COLORS[effect.category] || '#6b7280';

          return (
            <div
              key={effect.id}
              onClick={() => onSelect(effect)}
              title={`${effect.category}: ${effect.description.slice(0, 60)}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: `${width}%`,
                minWidth: 8,
                top: 4,
                bottom: 4,
                background: color,
                opacity: isSelected ? 1 : 0.7,
                borderRadius: 3,
                cursor: 'pointer',
                border: isSelected ? '2px solid #fff' : 'none',
                boxSizing: 'border-box',
                animation: isUnrated ? 'pulse 2s infinite' : undefined,
              }}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {Object.entries(CATEGORY_COLORS)
          .filter(([cat]) => effects.some(e => e.category === cat))
          .map(([cat, color]) => (
            <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
              <span style={{ fontSize: 10, color: c.text.secondary }}>{cat}</span>
            </div>
          ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
