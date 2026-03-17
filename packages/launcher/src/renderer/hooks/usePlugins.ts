import { useState, useEffect, useCallback } from 'react';
import { useIpc } from './useIpc.js';
import type { LauncherPluginInfo } from '@mayday/types';

export function usePlugins() {
  const ipc = useIpc();
  const [plugins, setPlugins] = useState<LauncherPluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const all = await ipc.plugins.getAll();
    setPlugins(all);
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    let retryCount = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const initialFetch = async () => {
      const all = await ipc.plugins.getAll();
      setPlugins(all);
      setLoading(false);
      if (all.length === 0 && retryCount < 5) {
        retryCount++;
        retryTimer = setTimeout(initialFetch, 2000);
      }
    };

    initialFetch();
    const unsub = ipc.plugins.onChanged(setPlugins);
    return () => {
      unsub();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [ipc]);

  const enable = useCallback(async (id: string) => {
    await ipc.plugins.enable(id);
    await refresh();
  }, [ipc, refresh]);

  const disable = useCallback(async (id: string) => {
    await ipc.plugins.disable(id);
    await refresh();
  }, [ipc, refresh]);

  const install = useCallback(async (sourcePath: string) => {
    await ipc.plugins.install(sourcePath);
    await refresh();
  }, [ipc, refresh]);

  return { plugins, loading, refresh, enable, disable, install };
}
