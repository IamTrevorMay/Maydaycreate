import React, { useState } from 'react';
import type { PluginManifest } from '@mayday/types';
import { PluginSettingsPanel } from './PluginSettingsPanel.js';
import { c } from '../styles.js';

interface Props {
  manifest: PluginManifest;
  children: React.ReactNode;
}

/**
 * Wraps a plugin page with an optional settings panel.
 * Shows a gear icon in the top-right when the plugin has a `config` schema.
 */
export function PluginPageWrapper({ manifest, children }: Props): React.ReactElement {
  const [showSettings, setShowSettings] = useState(false);
  const hasConfig = manifest.config && Object.keys(manifest.config).length > 0;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Gear icon */}
      {hasConfig && (
        <button
          onClick={() => setShowSettings((v) => !v)}
          title="Plugin Settings"
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 25,
            width: 28,
            height: 28,
            borderRadius: 4,
            border: `1px solid ${showSettings ? c.accent.primary : c.border.default}`,
            background: showSettings ? c.bg.elevated : 'transparent',
            color: showSettings ? c.accent.primary : c.text.secondary,
            fontSize: 14,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ⚙
        </button>
      )}

      {/* Page content */}
      {children}

      {/* Settings slide-over */}
      {showSettings && hasConfig && manifest.config && (
        <PluginSettingsPanel
          pluginId={manifest.id}
          schema={manifest.config}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
