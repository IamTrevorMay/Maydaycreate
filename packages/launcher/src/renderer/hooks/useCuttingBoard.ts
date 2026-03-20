import { useState, useEffect, useCallback, useRef } from 'react';
import { useIpc } from './useIpc.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun } from '@mayday/types';

export interface CloudMergeResult {
  cloudAccuracy: number;
  cloudTrainingSize: number;
  cloudVersion: number;
  localAccuracy: number;
  localTrainingSize: number;
}

export interface LocalTrainResult {
  version: number;
  accuracy: number;
  trainingSize: number;
}

export function useCuttingBoard() {
  const ipc = useIpc();
  const [stats, setStats] = useState<CuttingBoardAggregateStats | null>(null);
  const [trainingRuns, setTrainingRuns] = useState<CuttingBoardTrainingRun[]>([]);
  const [training, setTraining] = useState(false);
  const [postTrainResult, setPostTrainResult] = useState<LocalTrainResult | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<CloudMergeResult | null>(null);
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
    setPostTrainResult(null);
    setMergeResult(null);
    try {
      const result = await ipc.cuttingBoard.trainModel();
      if (result && result.version != null) {
        setTrainingRuns(prev => [{
          id: result.version,
          trainedAt: Date.now(),
          trainingSize: result.trainingSize,
          accuracy: result.accuracy,
          version: result.version,
        }, ...prev]);
        setPostTrainResult({ version: result.version, accuracy: result.accuracy, trainingSize: result.trainingSize });
      }
      await refresh();
    } finally {
      setTraining(false);
    }
  }, [ipc, refresh]);

  const cloudMergeTrain = useCallback(async () => {
    if (!postTrainResult) return;
    setMerging(true);
    try {
      const result = await ipc.cuttingBoard.cloudMergeTrain(postTrainResult);
      setMergeResult(result);
      await refresh();
    } catch (err) {
      console.error('[CuttingBoard] cloudMergeTrain error:', err);
    } finally {
      setMerging(false);
    }
  }, [ipc, postTrainResult, refresh]);

  const dismissPostTrain = useCallback(() => {
    setPostTrainResult(null);
    setMergeResult(null);
  }, []);

  return {
    stats, trainingRuns, training, trainModel, refresh,
    postTrainResult, merging, mergeResult, cloudMergeTrain, dismissPostTrain,
  };
}
