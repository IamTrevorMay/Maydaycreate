import React, { useState, useEffect } from 'react';
import type { PluginConfigSchema } from '@mayday/types';
import { useIpc } from '../hooks/useIpc.js';
import { c } from '../styles.js';

interface Props {
  pluginId: string;
  schema: PluginConfigSchema;
  onClose: () => void;
}

/**
 * Auto-generated settings panel rendered from a plugin's `config` schema.
 * Opens as an overlay panel on the right side of the content area.
 */
export function PluginSettingsPanel({ pluginId, schema, onClose }: Props): React.ReactElement {
  const ipc = useIpc();
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    ipc.plugins.getConfig(pluginId).then(setValues).catch(() => {});
  }, [ipc, pluginId]);

  const handleChange = async (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaving(key);
    try {
      await ipc.plugins.setConfigValue(pluginId, key, value);
    } catch (err) {
      console.error(`Failed to save config ${key}:`, err);
    }
    setTimeout(() => setSaving(null), 600);
  };

  const entries = Object.entries(schema);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 320,
        background: c.bg.secondary,
        borderLeft: `1px solid ${c.border.default}`,
        display: 'flex',
        flexDirection: 'column',
        zIndex: 20,
        boxShadow: '-4px 0 12px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: `1px solid ${c.border.default}`,
        }}
      >
        <span style={{ color: c.text.primary, fontSize: 13, fontWeight: 600 }}>Settings</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: c.text.secondary,
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          ✕
        </button>
      </div>

      {/* Settings fields */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {entries.map(([key, field]) => (
          <SettingsField
            key={key}
            fieldKey={key}
            field={field}
            value={values[key] ?? field.default}
            saving={saving === key}
            onChange={(val) => handleChange(key, val)}
          />
        ))}
        {entries.length === 0 && (
          <span style={{ color: c.text.disabled, fontSize: 12 }}>No configurable settings.</span>
        )}
      </div>
    </div>
  );
}

function SettingsField({
  fieldKey,
  field,
  value,
  saving,
  onChange,
}: {
  fieldKey: string;
  field: PluginConfigSchema[string];
  value: unknown;
  saving: boolean;
  onChange: (value: unknown) => void;
}): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ color: c.text.primary, fontSize: 12 }}>{field.label}</label>
        {saving && <span style={{ color: c.status.success, fontSize: 10 }}>Saved</span>}
      </div>

      {field.type === 'boolean' && (
        <button
          onClick={() => onChange(!value)}
          style={{
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            fontSize: 11,
            cursor: 'pointer',
            background: value ? c.accent.primary : c.bg.hover,
            color: value ? '#fff' : c.text.secondary,
            alignSelf: 'flex-start',
          }}
        >
          {value ? 'Enabled' : 'Disabled'}
        </button>
      )}

      {field.type === 'string' && (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )}

      {field.type === 'number' && (
        <input
          type="number"
          value={value != null ? Number(value) : ''}
          onChange={(e) => onChange(e.target.value === '' ? field.default : Number(e.target.value))}
          style={inputStyle}
        />
      )}

      {field.type === 'select' && field.options && (
        <select
          value={String(value ?? '')}
          onChange={(e) => {
            const opt = field.options?.find((o) => String(o.value) === e.target.value);
            onChange(opt?.value ?? e.target.value);
          }}
          style={{
            ...inputStyle,
            cursor: 'pointer',
          }}
        >
          {field.options.map((opt) => (
            <option key={String(opt.value)} value={String(opt.value)}>
              {opt.label}
            </option>
          ))}
        </select>
      )}

      {field.description && (
        <span style={{ color: c.text.disabled, fontSize: 10 }}>{field.description}</span>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  border: `1px solid #333`,
  background: '#1e1e1e',
  color: '#e0e0e0',
  fontSize: 12,
  outline: 'none',
};
