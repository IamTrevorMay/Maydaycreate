import { useState, useEffect, useCallback, useRef } from 'react';
import { useIpc } from './useIpc.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun } from '@mayday/types';

export function useCuttingBoard() {
  const ipc = useIpc();
  const [stats, setStats] = useState<CuttingBoardAggregateStats | null>(null);
  const [trainingRuns, setTrainingRuns] = useState<CuttingBoardTrainingRun[]>([]);
  const [training, setTraining] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([
        ipc.cuttingBoard.getAggregateStats(),
        ipc.cuttingBoard.getTrainingRuns(),
      ]);
      setStats(s);
      setTrainingRuns(r);
    } catch {}
  }, [ipc]);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refresh]);

  const trainModel = useCallback(async () => {
    setTraining(true);
    try {
      await ipc.cuttingBoard.trainModel();
      await refresh();
    } finally {
      setTraining(false);
    }
  }, [ipc, refresh]);

  return { stats, trainingRuns, training, trainModel, refresh };
}
