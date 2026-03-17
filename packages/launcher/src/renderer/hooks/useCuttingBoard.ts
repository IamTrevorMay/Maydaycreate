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
      const s = await ipc.cuttingBoard.getAggregateStats();
      setStats(s);
    } catch (err) {
      console.error('[CuttingBoard] getAggregateStats error:', err);
    }
    try {
      const r = await ipc.cuttingBoard.getTrainingRuns();
      setTrainingRuns(r);
    } catch (err) {
      console.error('[CuttingBoard] getTrainingRuns error:', err);
    }
  }, [ipc]);

  useEffect(() => {
    refresh();
    intervalRef.current = setInterval(refresh, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refresh]);

  const trainModel = useCallback(async () => {
    setTraining(true);
    try {
      const result = await ipc.cuttingBoard.trainModel();
      // If training returned a result with version/accuracy, use it to update trainingRuns immediately
      if (result && result.version != null) {
        setTrainingRuns(prev => [{
          id: result.version,
          trainedAt: Date.now(),
          trainingSize: result.trainingSize,
          accuracy: result.accuracy,
          version: result.version,
        }, ...prev]);
      }
      await refresh();
    } finally {
      setTraining(false);
    }
  }, [ipc, refresh]);

  return { stats, trainingRuns, training, trainModel, refresh };
}
