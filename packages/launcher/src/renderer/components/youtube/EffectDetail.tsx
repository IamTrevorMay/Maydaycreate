import React, { useState } from 'react';
import { c } from '../../styles.js';
import type { DetectedEffect, TrainingStats } from '@mayday/types';

const CONFIDENCE_COLORS: Record<string, string> = {
  high: c.status.success,
  medium: c.status.warning,
  low: c.status.error,
};

const RATING_BUTTONS: { value: number; color: string }[] = [
  { value: 1, color: '#ef4444' },
  { value: 2, color: '#f97316' },
  { value: 3, color: '#eab308' },
  { value: 4, color: '#84cc16' },
  { value: 5, color: '#22c55e' },
];

interface EffectDetailProps {
  effect: DetectedEffect;
  onRate: (effectId: string, rating: number, note?: string) => void;
  onSavePreset: (effectId: string, name: string, tags?: string[]) => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  effectPosition?: string;
  trainingStats?: TrainingStats;
}

export function EffectDetail({ effect, onRate, onSavePreset, onPrev, onNext, hasPrev, hasNext, effectPosition, trainingStats }: EffectDetailProps): React.ReactElement {
  const [correctionNote, setCorrectionNote] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showPresetForm, setShowPresetForm] = useState(false);

  const handleRate = (value: number) => {
    if (value <= 2) {
      onRate(effect.id, value, correctionNote || undefined);
    } else {
      onRate(effect.id, value);
    }
    onNext?.();
  };

  const handleSavePreset = () => {
    if (!presetName.trim()) return;
    onSavePreset(effect.id, presetName.trim(), [effect.category]);
    setPresetName('');
    setShowPresetForm(false);
  };

  return (
    <div style={{
      padding: 20,
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${c.border.default}`,
      margin: '0 20px 20px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{
          padding: '2px 8px',
          background: c.accent.primary,
          color: '#fff',
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
        }}>
          {effect.category}
        </span>
        <span style={{
          padding: '2px 8px',
          background: CONFIDENCE_COLORS[effect.confidence] || c.text.disabled,
          color: '#000',
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
        }}>
          {effect.confidence}
        </span>
        <span style={{ color: c.text.secondary, fontSize: 11, marginLeft: 'auto' }}>
          {effect.startTime.toFixed(1)}s - {effect.endTime.toFixed(1)}s
        </span>
      </div>

      {/* Frame comparison */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {effect.frameBefore && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: c.text.secondary, marginBottom: 4 }}>Before</div>
            <img
              src={`mayday-frame://${effect.frameBefore}`}
              alt="Before"
              style={{ width: '100%', borderRadius: 4, display: 'block' }}
            />
          </div>
        )}
        {effect.frameAfter && (
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: c.text.secondary, marginBottom: 4 }}>After</div>
            <img
              src={`mayday-frame://${effect.frameAfter}`}
              alt="After"
              style={{ width: '100%', borderRadius: 4, display: 'block' }}
            />
          </div>
        )}
      </div>

      {/* Description */}
      <p style={{ color: c.text.primary, fontSize: 13, lineHeight: 1.5, margin: '0 0 16px' }}>
        {effect.description}
      </p>

      {/* Premiere Recreation */}
      {effect.premiereRecreation.steps.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: c.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            Premiere Pro Recreation
          </div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {effect.premiereRecreation.steps.map((step, i) => (
              <li key={i} style={{ color: c.text.primary, fontSize: 12, marginBottom: 4, lineHeight: 1.4 }}>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Suggested Effects */}
      {effect.premiereRecreation.suggestedEffects.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: c.text.secondary, fontSize: 11, marginBottom: 4 }}>Suggested Effects</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {effect.premiereRecreation.suggestedEffects.map((name, i) => (
              <span key={i} style={{
                padding: '2px 8px',
                background: c.bg.tertiary,
                color: c.text.primary,
                borderRadius: 4,
                fontSize: 11,
              }}>
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Parameters */}
      {Object.keys(effect.premiereRecreation.estimatedParameters).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: c.text.secondary, fontSize: 11, marginBottom: 4 }}>Estimated Parameters</div>
          <div style={{ background: c.bg.primary, borderRadius: 4, padding: 8 }}>
            {Object.entries(effect.premiereRecreation.estimatedParameters).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0' }}>
                <span style={{ color: c.text.secondary }}>{key}</span>
                <span style={{ color: c.text.primary }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {effect.premiereRecreation.notes && (
        <div style={{ color: c.text.secondary, fontSize: 11, fontStyle: 'italic', marginBottom: 16 }}>
          {effect.premiereRecreation.notes}
        </div>
      )}

      {/* 1-5 Rating */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: c.text.secondary, marginBottom: 8 }}>
          Rate accuracy (1-5, or press keys 1-5)
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {RATING_BUTTONS.map(({ value, color }) => {
            const isSelected = effect.rating === value;
            const hasRating = effect.rating != null;
            return (
              <button
                key={value}
                onClick={() => handleRate(value)}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 8,
                  border: 'none',
                  background: isSelected ? color : c.bg.tertiary,
                  color: isSelected ? '#fff' : c.text.primary,
                  fontSize: 18,
                  fontWeight: 700,
                  cursor: 'pointer',
                  opacity: hasRating && !isSelected ? 0.4 : 1,
                  transition: 'all 0.15s',
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>

      {/* Correction note for low ratings */}
      {(effect.rating == null || effect.rating <= 2) && (
        <div style={{ marginBottom: 12 }}>
          <input
            type="text"
            value={correctionNote}
            onChange={(e) => setCorrectionNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && correctionNote) {
                handleRate(effect.rating || 2);
              }
            }}
            placeholder="What was wrong? (optional, for ratings 1-2)"
            className="effect-detail-correction"
            style={{
              width: '100%',
              padding: '6px 10px',
              background: c.bg.primary,
              border: `1px solid ${c.border.default}`,
              borderRadius: 4,
              color: c.text.primary,
              fontSize: 11,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Save as Preset */}
      {effect.savedPresetId ? (
        <div style={{ fontSize: 11, color: c.status.success }}>
          Saved as preset
        </div>
      ) : showPresetForm ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
            placeholder="Preset name..."
            style={{
              flex: 1,
              padding: '6px 10px',
              background: c.bg.primary,
              border: `1px solid ${c.border.default}`,
              borderRadius: 4,
              color: c.text.primary,
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button
            onClick={handleSavePreset}
            disabled={!presetName.trim()}
            style={{
              padding: '6px 14px',
              background: c.accent.primary,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              cursor: presetName.trim() ? 'pointer' : 'not-allowed',
              opacity: presetName.trim() ? 1 : 0.5,
            }}
          >
            Save
          </button>
          <button
            onClick={() => setShowPresetForm(false)}
            style={{
              padding: '6px 10px',
              background: c.bg.tertiary,
              color: c.text.secondary,
              border: 'none',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowPresetForm(true)}
          style={{
            padding: '6px 14px',
            background: c.bg.tertiary,
            color: c.text.primary,
            border: `1px solid ${c.border.default}`,
            borderRadius: 4,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Save as Preset
        </button>
      )}

      {/* Training stats row */}
      {trainingStats && trainingStats.totalEffects > 0 && (
        <div style={{
          display: 'flex',
          gap: 12,
          marginTop: 14,
          paddingTop: 10,
          borderTop: `1px solid ${c.border.default}`,
          fontSize: 11,
          color: c.text.secondary,
        }}>
          <span>Rated: {trainingStats.ratedEffects}/{trainingStats.totalEffects} ({trainingStats.totalEffects > 0 ? Math.round((trainingStats.ratedEffects / trainingStats.totalEffects) * 100) : 0}%)</span>
          <span>Avg: {trainingStats.averageRating.toFixed(1)}</span>
          <span>Accuracy: {trainingStats.accuracyPercent}%</span>
        </div>
      )}

      {/* Navigation bar */}
      {(onPrev || onNext) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 14,
          paddingTop: 10,
          borderTop: `1px solid ${c.border.default}`,
        }}>
          <button
            onClick={onPrev}
            disabled={!hasPrev}
            style={{
              padding: '4px 12px',
              background: hasPrev ? c.bg.tertiary : 'transparent',
              color: hasPrev ? c.text.primary : c.text.disabled,
              border: `1px solid ${hasPrev ? c.border.default : 'transparent'}`,
              borderRadius: 4,
              fontSize: 12,
              cursor: hasPrev ? 'pointer' : 'default',
              opacity: hasPrev ? 1 : 0.4,
            }}
          >
            ← Prev
          </button>
          {effectPosition && (
            <span style={{ fontSize: 11, color: c.text.secondary, fontWeight: 600 }}>
              {effectPosition}
            </span>
          )}
          <button
            onClick={onNext}
            disabled={!hasNext}
            style={{
              padding: '4px 12px',
              background: hasNext ? c.bg.tertiary : 'transparent',
              color: hasNext ? c.text.primary : c.text.disabled,
              border: `1px solid ${hasNext ? c.border.default : 'transparent'}`,
              borderRadius: 4,
              fontSize: 12,
              cursor: hasNext ? 'pointer' : 'default',
              opacity: hasNext ? 1 : 0.4,
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
