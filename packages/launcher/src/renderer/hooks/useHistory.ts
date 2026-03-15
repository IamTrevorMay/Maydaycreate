import { useState, useEffect, useCallback } from 'react';
import { useIpc } from './useIpc.js';
import type { HistorySnapshot } from '@mayday/sync-engine';

export function useHistory() {
  const ipc = useIpc();
  const [snapshots, setSnapshots] = useState<HistorySnapshot[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await ipc.history.list();
    setSnapshots(list);
    setLoading(false);
  }, [ipc]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const createSnapshot = useCallback(async () => {
    const snap = await ipc.history.createSnapshot();
    await refresh();
    return snap;
  }, [ipc, refresh]);

  const restore = useCallback(async (snapshot: HistorySnapshot) => {
    await ipc.history.restore(snapshot);
    await refresh();
  }, [ipc, refresh]);

  return { snapshots, loading, refresh, createSnapshot, restore };
}
