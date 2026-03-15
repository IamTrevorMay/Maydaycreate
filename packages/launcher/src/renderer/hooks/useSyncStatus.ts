import { useState, useEffect, useCallback } from 'react';
import { useIpc } from './useIpc.js';
import type { SyncStatus, SyncConflict, SyncLogEntry, OfflineQueueEntry } from '@mayday/sync-engine';

export function useSyncStatus() {
  const ipc = useIpc();
  const [status, setStatus] = useState<SyncStatus>({
    state: 'idle',
    pendingCount: 0,
    conflictCount: 0,
  });
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);
  const [queue, setQueue] = useState<OfflineQueueEntry[]>([]);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);

  const refresh = useCallback(async () => {
    const [s, c, q, log] = await Promise.all([
      ipc.sync.getStatus(),
      ipc.sync.getConflicts(),
      ipc.sync.getQueue(),
      ipc.sync.getSyncLog(),
    ]);
    setStatus(s);
    setConflicts(c);
    setQueue(q);
    setSyncLog(log);
  }, [ipc]);

  useEffect(() => {
    refresh();
    const unsub = ipc.sync.onStatusChanged((s) => {
      setStatus(s);
      ipc.sync.getConflicts().then(setConflicts);
      ipc.sync.getQueue().then(setQueue);
      ipc.sync.getSyncLog().then(setSyncLog);
    });
    return unsub;
  }, [refresh, ipc]);

  const runSync = useCallback(async () => {
    await ipc.sync.runSync();
    await refresh();
  }, [ipc, refresh]);

  const resolveConflict = useCallback(
    async (relativePath: string, choice: 'keep-mine' | 'use-theirs') => {
      await ipc.sync.resolveConflict({ relativePath, choice });
      await refresh();
    },
    [ipc, refresh],
  );

  const flushQueue = useCallback(async () => {
    await ipc.sync.flushQueue();
    await refresh();
  }, [ipc, refresh]);

  return { status, conflicts, queue, syncLog, runSync, resolveConflict, flushQueue, refresh };
}
