import React, { useState, useMemo } from 'react';
import { usePlugins } from '../hooks/usePlugins.js';
import { useIpc } from '../hooks/useIpc.js';
import type { LauncherPluginInfo, PluginCategory } from '@mayday/types';
import { c } from '../styles.js';

const CATEGORIES: Array<{ id: PluginCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'editing', label: 'Editing' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'effects', label: 'Effects' },
  { id: 'automation', label: 'Automation' },
  { id: 'hardware', label: 'Hardware' },
  { id: 'utility', label: 'Utility' },
];

export function MarketplacePage(): React.ReactElement {
  const { plugins, loading, enable, disable, install } = usePlugins();
  const ipc = useIpc();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PluginCategory | 'all'>('all');

  const filtered = useMemo(() => {
    let result = plugins;

    if (category !== 'all') {
      result = result.filter((p) => p.manifest.marketplace?.category === category);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.manifest.name.toLowerCase().includes(q) ||
          p.manifest.description.toLowerCase().includes(q) ||
          p.manifest.marketplace?.tags?.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [plugins, search, category]);

  const installedCount = plugins.length;
  const activeCount = plugins.filter((p) => p.status === 'activated').length;

  const handleInstallFromDisk = async () => {
    const dir = await ipc.dialog.openPlugin();
    if (dir) {
      try {
        await install(dir);
      } catch (err) {
        console.error('Install failed:', err);
      }
    }
  };

  return (
    <div style={{ padding: '20px 24px', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ color: c.text.primary, fontSize: 16, fontWeight: 600 }}>Marketplace</h2>
          <p style={{ color: c.text.secondary, fontSize: 12, marginTop: 4 }}>
            {loading ? 'Loading...' : `${activeCount} active, ${installedCount} installed`}
          </p>
        </div>
        <button onClick={handleInstallFromDisk} style={secondaryBtn}>
          Install from Disk
        </button>
      </div>

      {/* Search + Category filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: '1 1 200px',
            padding: '7px 12px',
            borderRadius: 4,
            border: `1px solid ${c.border.default}`,
            background: c.bg.secondary,
            color: c.text.primary,
            fontSize: 12,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setCategory(cat.id)}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                border: `1px solid ${category === cat.id ? c.accent.primary : c.border.default}`,
                background: category === cat.id ? c.accent.primary : 'transparent',
                color: category === cat.id ? '#fff' : c.text.secondary,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Installed plugins */}
      {loading ? (
        <div style={{ color: c.text.disabled, fontSize: 13 }}>Loading plugins...</div>
      ) : (
        <>
          <SectionLabel label="Installed" count={filtered.length} />
          {filtered.length === 0 ? (
            <EmptyState
              message={
                search || category !== 'all'
                  ? 'No plugins match your search.'
                  : 'No plugins installed yet. Install one from disk to get started.'
              }
            />
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
                marginBottom: 24,
              }}
            >
              {filtered.map((p) => (
                <MarketplaceCard
                  key={p.manifest.id}
                  plugin={p}
                  onEnable={enable}
                  onDisable={disable}
                />
              ))}
            </div>
          )}

          {/* Available (future remote registry) */}
          <SectionLabel label="Available" count={0} />
          <EmptyState message="Remote plugin registry coming soon. For now, install plugins from disk." />
        </>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SectionLabel({ label, count }: { label: string; count: number }): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <h3 style={{ color: c.text.secondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </h3>
      <span style={{
        color: c.text.disabled,
        fontSize: 10,
        background: c.bg.elevated,
        borderRadius: 8,
        padding: '1px 6px',
      }}>
        {count}
      </span>
    </div>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div
      style={{
        background: c.bg.elevated,
        border: `1px solid ${c.border.default}`,
        borderRadius: 6,
        padding: 24,
        textAlign: 'center',
        color: c.text.secondary,
        fontSize: 12,
        marginBottom: 24,
      }}
    >
      {message}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  activated: c.status.success,
  deactivated: c.text.disabled,
  errored: c.status.error,
  loaded: c.status.warning,
  discovered: c.text.secondary,
};

function MarketplaceCard({
  plugin,
  onEnable,
  onDisable,
}: {
  plugin: LauncherPluginInfo;
  onEnable: (id: string) => void;
  onDisable: (id: string) => void;
}): React.ReactElement {
  const { manifest, status } = plugin;
  const isActive = status === 'activated';
  const dotColor = STATUS_COLORS[status] ?? c.text.disabled;
  const category = manifest.marketplace?.category;

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
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
        <span style={{ fontSize: 10, color: c.text.secondary, flexShrink: 0 }}>v{manifest.version}</span>
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
          margin: 0,
        }}
      >
        {manifest.description}
      </p>

      {/* Tags row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {category && (
          <span style={{
            fontSize: 9,
            color: c.accent.primary,
            border: `1px solid ${c.accent.primary}44`,
            borderRadius: 8,
            padding: '1px 6px',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
          }}>
            {category}
          </span>
        )}
        {manifest.targetApp && manifest.targetApp !== 'any' && (
          <span style={{
            fontSize: 9,
            color: c.text.disabled,
            border: `1px solid ${c.border.default}`,
            borderRadius: 8,
            padding: '1px 6px',
          }}>
            {manifest.targetApp}
          </span>
        )}
        {manifest.author && (
          <span style={{ fontSize: 10, color: c.text.disabled, marginLeft: 'auto' }}>
            {manifest.author}
          </span>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        <span style={{ fontSize: 10, color: c.text.disabled, textTransform: 'uppercase' }}>
          {status}
        </span>
        <button
          onClick={() => isActive ? onDisable(manifest.id) : onEnable(manifest.id)}
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

const secondaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  borderRadius: 4,
  border: '1px solid #444',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
};
