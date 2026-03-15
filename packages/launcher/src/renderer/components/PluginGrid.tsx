import React from 'react';
import type { LauncherPluginInfo } from '@mayday/types';
import { PluginCard } from './PluginCard.js';

interface Props {
  plugins: LauncherPluginInfo[];
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
}

export function PluginGrid({ plugins, onEnable, onDisable }: Props): React.ReactElement {
  if (plugins.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 13,
        }}
      >
        No plugins installed
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: 12,
        padding: '16px 0',
      }}
    >
      {plugins.map((p) => (
        <PluginCard
          key={p.manifest.id}
          plugin={p}
          onEnable={onEnable}
          onDisable={onDisable}
        />
      ))}
    </div>
  );
}
