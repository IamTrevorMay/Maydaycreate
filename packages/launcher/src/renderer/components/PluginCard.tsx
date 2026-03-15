import React from 'react';
import type { LauncherPluginInfo } from '@mayday/types';
import { c } from '../styles.js';

interface Props {
  plugin: LauncherPluginInfo;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  activated: c.status.success,
  deactivated: c.text.disabled,
  errored: c.status.error,
  loaded: c.status.warning,
  discovered: c.text.secondary,
};

export function PluginCard({ plugin, onEnable, onDisable }: Props): React.ReactElement {
  const { manifest, status } = plugin;
  const isActive = status === 'activated';
  const dotColor = STATUS_COLORS[status] ?? c.text.disabled;

  const handleToggle = () => {
    if (isActive) onDisable(manifest.id);
    else onEnable(manifest.id);
  };

  return (
    <div
      style={{
        background: c.bg.elevated,
        border: `1px solid ${c.border.default}`,
        borderRadius: 6,
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minWidth: 0,
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dotColor,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            flex: 1,
            fontWeight: 600,
            fontSize: 13,
            color: c.text.primary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {manifest.name}
        </span>
        <span style={{ fontSize: 10, color: c.text.secondary, flexShrink: 0 }}>
          v{manifest.version}
        </span>
      </div>

      {/* Description */}
      <p
        style={{
          color: c.text.secondary,
          fontSize: 11,
          lineHeight: 1.5,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}
      >
        {manifest.description}
      </p>

      {/* Footer row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: c.text.disabled, textTransform: 'uppercase' }}>
          {status}
        </span>
        <button
          onClick={handleToggle}
          disabled={status === 'errored'}
          style={{
            padding: '3px 10px',
            borderRadius: 4,
            border: 'none',
            fontSize: 11,
            cursor: status === 'errored' ? 'not-allowed' : 'pointer',
            background: isActive ? c.bg.hover : c.accent.primary,
            color: isActive ? c.text.secondary : '#fff',
            opacity: status === 'errored' ? 0.5 : 1,
          }}
        >
          {isActive ? 'Disable' : 'Enable'}
        </button>
      </div>
    </div>
  );
}
