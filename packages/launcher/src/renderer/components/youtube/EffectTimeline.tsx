import React from 'react';
import { c } from '../../styles.js';
import type { DetectedEffect, EffectCategory } from '@mayday/types';

export const CATEGORY_COLORS: Partial<Record<EffectCategory, string>> = {
  transition: '#60a5fa',
  'color-grade': '#fbbf24',
  transform: '#34d399',
  overlay: '#a78bfa',
  compositing: '#818cf8',
  'speed-ramp': '#fb923c',
  'lens-effect': '#94a3b8',
  other: '#6b7280',
};

const RATING_COLORS: Record<number, string> = {
  1: '#ef4444',
  2: '#f97316',
  3: '#eab308',
  4: '#84cc16',
  5: '#22c55e',
};

interface EffectTimelineProps {
  effects: DetectedEffect[];
  duration: number;
  selectedId: string | null;
  onSelect: (effect: DetectedEffect) => void;
  activeCategories: Set<EffectCategory>;
  onToggleCategory: (cat: EffectCategory) => void;
  viewMode: 'timeline' | 'list';
  onSetViewMode: (mode: 'timeline' | 'list') => void;
}

export function EffectTimeline({ effects, duration, selectedId, onSelect, activeCategories, onToggleCategory, viewMode, onSetViewMode }: EffectTimelineProps): React.ReactElement {
  if (duration <= 0) return <div />;

  // Count effects per category (from all effects, not filtered)
  const categoryCounts = new Map<EffectCategory, number>();
  for (const e of effects) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
  }

  // Get unique categories present
  const presentCategories = Array.from(categoryCounts.keys());

  // Filter effects by active categories
  const filteredEffects = effects.filter(e => activeCategories.has(e.category));

  const timeToPercent = (time: number) => (time / duration) * 100;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      padding: '12px 20px',
      background: c.bg.secondary,
      borderBottom: `1px solid ${c.border.default}`,
    }}>
      {/* Header row: label + view toggle */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: c.text.secondary }}>
          Timeline ({filteredEffects.length} of {effects.length} effects)
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['timeline', 'list'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onSetViewMode(mode)}
              style={{
                padding: '3px 10px',
                background: viewMode === mode ? c.accent.primary : c.bg.tertiary,
                color: viewMode === mode ? '#fff' : c.text.secondary,
                border: 'none',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: viewMode === mode ? 600 : 400,
                cursor: 'pointer',
              }}
            >
              {mode === 'timeline' ? 'Timeline' : 'List'}
            </button>
          ))}
        </div>
      </div>

      {/* Category filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {presentCategories.map(cat => {
          const color = CATEGORY_COLORS[cat] || '#6b7280';
          const isActive = activeCategories.has(cat);
          const count = categoryCounts.get(cat) || 0;
          return (
            <button
              key={cat}
              onClick={() => onToggleCategory(cat)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 10px',
                background: isActive ? color : c.bg.tertiary,
                color: isActive ? '#000' : c.text.disabled,
                border: `1px solid ${isActive ? color : c.border.default}`,
                borderRadius: 12,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
                opacity: isActive ? 1 : 0.5,
                transition: 'all 0.15s',
              }}
            >
              {cat}
              <span style={{
                background: isActive ? 'rgba(0,0,0,0.2)' : c.bg.elevated,
                borderRadius: 8,
                padding: '0 5px',
                fontSize: 9,
              }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {viewMode === 'timeline' ? (
        <>
          {/* Timeline view */}
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
            {filteredEffects.map(effect => {
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
        </>
      ) : (
        /* List view */
        <div style={{
          maxHeight: 300,
          overflow: 'auto',
          borderRadius: 4,
          background: c.bg.elevated,
        }}>
          {filteredEffects.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: c.text.disabled, fontSize: 12 }}>
              No effects match the selected categories
            </div>
          ) : filteredEffects.map(effect => {
            const color = CATEGORY_COLORS[effect.category] || '#6b7280';
            const isSelected = effect.id === selectedId;
            return (
              <div
                key={effect.id}
                onClick={() => onSelect(effect)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderLeft: `3px solid ${color}`,
                  background: isSelected ? c.bg.tertiary : 'transparent',
                  cursor: 'pointer',
                  borderBottom: `1px solid ${c.border.default}`,
                }}
              >
                {/* Timestamp */}
                <span style={{ fontSize: 11, color: c.text.secondary, fontFamily: 'monospace', minWidth: 45, flexShrink: 0 }}>
                  {formatTime(effect.startTime)}
                </span>

                {/* Category badge */}
                <span style={{
                  padding: '1px 7px',
                  background: color,
                  color: '#000',
                  borderRadius: 4,
                  fontSize: 9,
                  fontWeight: 600,
                  flexShrink: 0,
                }}>
                  {effect.category}
                </span>

                {/* Description (truncated) */}
                <span style={{
                  flex: 1,
                  fontSize: 11,
                  color: c.text.primary,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {effect.description}
                </span>

                {/* Rating indicator */}
                {effect.rating != null && (
                  <span style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: RATING_COLORS[effect.rating] || c.bg.tertiary,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {effect.rating}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
