import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { LauncherPluginInfo } from '@mayday/types';
import { useIpc } from './hooks/useIpc.js';
import { PluginPageHost } from './components/PluginPageHost.js';
import { PluginPageWrapper } from './components/PluginPageWrapper.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SidebarEntry {
  id: string;
  label: string;
  icon?: string;
  order: number;
  badge?: number;
  type: 'core' | 'plugin';
}

interface PluginUIRegistryValue {
  /** All sidebar entries (core + plugin), sorted by order */
  sidebarEntries: SidebarEntry[];
  /** Current plugin list from the server */
  plugins: LauncherPluginInfo[];
  /** Resolve the React component for a page ID. Returns null for unknown IDs. */
  getPageComponent(id: string): React.ComponentType | null;
}

// ── Core page registry ─────────────────────────────────────────────────────────

const CORE_ENTRIES: SidebarEntry[] = [
  { id: 'marketplace', label: 'Marketplace', order: 0, type: 'core' },
  { id: 'sync', label: 'Adobe Sync', order: 10, type: 'core' },
  { id: 'settings', label: 'Settings', order: 999, type: 'core' },
];

/**
 * Static map of page ID → React component.
 * Core pages are registered here at init. Plugin "core plugin" pages
 * (code still in renderer) can also be registered here during Step 3/7.
 */
const componentMap = new Map<string, React.ComponentType>();

/** Register a React component for a page ID (used by core pages and "core plugins") */
export function registerPageComponent(id: string, component: React.ComponentType): void {
  componentMap.set(id, component);
}

// ── Context ────────────────────────────────────────────────────────────────────

const PluginUIRegistryContext = createContext<PluginUIRegistryValue | null>(null);

export function usePluginUIRegistry(): PluginUIRegistryValue {
  const ctx = useContext(PluginUIRegistryContext);
  if (!ctx) throw new Error('usePluginUIRegistry must be used within PluginUIRegistryProvider');
  return ctx;
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function PluginUIRegistryProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const ipc = useIpc();
  const [plugins, setPlugins] = useState<LauncherPluginInfo[]>([]);

  // Fetch plugin list on mount + poll until plugins arrive (server may still be starting)
  useEffect(() => {
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    const fetchPlugins = async () => {
      try {
        const all = await ipc.plugins.getAll();
        setPlugins(all);
        // Retry up to 10 times if empty (server may still be loading)
        if (all.length === 0 && retryCount < 10) {
          retryCount++;
          retryTimer = setTimeout(fetchPlugins, 1500);
        }
      } catch {
        if (retryCount < 10) {
          retryCount++;
          retryTimer = setTimeout(fetchPlugins, 1500);
        }
      }
    };

    fetchPlugins();
    const unsub = ipc.plugins.onChanged((all) => {
      setPlugins(all);
      retryCount = 10; // Stop retrying once we get a push
    });
    return () => {
      unsub();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [ipc]);

  // Build plugin sidebar entries from manifests that declare ui.page
  const pluginEntries = useMemo<SidebarEntry[]>(() => {
    return plugins
      .filter((p) => p.manifest.ui?.page && p.status === 'activated')
      .map((p) => ({
        id: p.manifest.id,
        label: p.manifest.ui?.sidebarLabel ?? p.manifest.name,
        icon: p.manifest.ui?.sidebarIcon,
        order: p.manifest.ui?.sidebarOrder ?? 100,
        type: 'plugin' as const,
      }));
  }, [plugins]);

  // Merge core + plugin entries, sorted by order
  const sidebarEntries = useMemo<SidebarEntry[]>(() => {
    return [...CORE_ENTRIES, ...pluginEntries].sort((a, b) => a.order - b.order);
  }, [pluginEntries]);

  // Cache dynamically created iframe wrapper components so they're stable across renders
  const iframeComponentCache = useMemo(() => new Map<string, React.ComponentType>(), []);

  const getPageComponent = useCallback((id: string): React.ComponentType | null => {
    // Check static registrations first (core pages + core plugins)
    const staticComponent = componentMap.get(id);
    if (staticComponent) return staticComponent;

    // Check if this is a plugin with a rendererEntry — create an iframe host component
    const plugin = plugins.find((p) => p.manifest.id === id);
    const entry = plugin?.manifest.ui?.rendererEntry;
    if (plugin && entry) {
      let cached = iframeComponentCache.get(id);
      if (!cached) {
        const pluginId = id;
        const rendererEntry = entry;
        const manifest = plugin.manifest;
        cached = function PluginPage() {
          return React.createElement(
            PluginPageWrapper,
            { manifest },
            React.createElement(PluginPageHost, { pluginId, rendererEntry }),
          );
        };
        iframeComponentCache.set(id, cached);
      }
      return cached;
    }

    return null;
  }, [plugins, iframeComponentCache]);

  const value = useMemo<PluginUIRegistryValue>(
    () => ({ sidebarEntries, plugins, getPageComponent }),
    [sidebarEntries, plugins, getPageComponent],
  );

  return (
    <PluginUIRegistryContext.Provider value={value}>
      {children}
    </PluginUIRegistryContext.Provider>
  );
}
