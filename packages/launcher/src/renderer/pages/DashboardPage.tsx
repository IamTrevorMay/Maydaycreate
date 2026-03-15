import React from 'react';
import { PluginGrid } from '../components/PluginGrid.js';
import { usePlugins } from '../hooks/usePlugins.js';
import { c } from '../styles.js';

export function DashboardPage(): React.ReactElement {
  const { plugins, loading, enable, disable } = usePlugins();

  const active = plugins.filter(p => p.status === 'activated').length;

  return (
    <div style={{ padding: '20px 24px', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Plugins</h2>
        <p style={{ color: c.text.secondary, fontSize: 12, marginTop: 4 }}>
          {loading ? 'Loading…' : `${active} of ${plugins.length} active`}
        </p>
      </div>

      {/* Grid */}
      {loading ? (
        <div style={{ color: c.text.disabled, fontSize: 13 }}>Loading plugins…</div>
      ) : (
        <PluginGrid plugins={plugins} onEnable={enable} onDisable={disable} />
      )}
    </div>
  );
}
