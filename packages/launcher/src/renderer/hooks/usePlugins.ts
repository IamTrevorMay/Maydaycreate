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
    refresh();
    const unsub = ipc.plugins.onChanged(setPlugins);
    return unsub;
  }, [refresh, ipc]);

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
