import React, { useState } from 'react';
import { c } from '../../styles.js';
import type { DetectedEffect } from '@mayday/types';

const CONFIDENCE_COLORS: Record<string, string> = {
  high: c.status.success,
  medium: c.status.warning,
  low: c.status.error,
};

interface EffectDetailProps {
  effect: DetectedEffect;
  onRate: (effectId: string, rating: number, note?: string) => void;
  onSavePreset: (effectId: string, name: string, tags?: string[]) => void;
}

export function EffectDetail({ effect, onRate, onSavePreset }: EffectDetailProps): React.ReactElement {
  const [correctionNote, setCorrectionNote] = useState('');
  const [presetName, setPresetName] = useState('');
  const [showPresetForm, setShowPresetForm] = useState(false);

  const handleThumbsDown = () => {
    onRate(effect.id, -1, correctionNote || undefined);
    setCorrectionNote('');
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

      {/* Rating */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: c.text.secondary }}>Accurate?</span>
        <button
          onClick={() => onRate(effect.id, 1)}
          style={{
            padding: '4px 12px',
            background: effect.rating === 1 ? c.status.success : c.bg.tertiary,
            color: effect.rating === 1 ? '#000' : c.text.primary,
            border: 'none',
            borderRadius: 4,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          +
        </button>
        <button
          onClick={() => effect.rating !== -1 && handleThumbsDown()}
          style={{
            padding: '4px 12px',
            background: effect.rating === -1 ? c.status.error : c.bg.tertiary,
            color: effect.rating === -1 ? '#fff' : c.text.primary,
            border: 'none',
            borderRadius: 4,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          -
        </button>

        {/* Correction input for thumbs down */}
        {effect.rating !== 1 && (
          <input
            type="text"
            value={correctionNote}
            onChange={(e) => setCorrectionNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleThumbsDown()}
            placeholder="What was wrong? (optional)"
            style={{
              flex: 1,
              padding: '4px 8px',
              background: c.bg.primary,
              border: `1px solid ${c.border.default}`,
              borderRadius: 4,
              color: c.text.primary,
              fontSize: 11,
              outline: 'none',
            }}
          />
        )}
      </div>

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
    </div>
  );
}
