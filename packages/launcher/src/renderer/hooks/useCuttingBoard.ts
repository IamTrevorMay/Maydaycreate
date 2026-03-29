import { useState, useEffect, useCallback, useRef } from 'react';
import { useIpc } from './useIpc.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun, CuttingBoardSession, CuttingBoardTrainingDataSummary, CloudTrainingRun } from '@mayday/types';

export interface LocalTrainResult {
  version: number;
  accuracy: number;
  trainingSize: number;
}

export function useCuttingBoard() {
  const ipc = useIpc();
  const [stats, setStats] = useState<CuttingBoardAggregateStats | null>(null);
  const [trainingRuns, setTrainingRuns] = useState<CuttingBoardTrainingRun[]>([]);
  const [sessions, setSessions] = useState<CuttingBoardSession[]>([]);
  const [trainingDataSummary, setTrainingDataSummary] = useState<CuttingBoardTrainingDataSummary | null>(null);
  const [cloudRegistry, setCloudRegistry] = useState<CloudTrainingRun[]>([]);
  const [training, setTraining] = useState(false);
  const [postTrainResult, setPostTrainResult] = useState<LocalTrainResult | null>(null);
  const [loaded, setLoaded] = useState(false);
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
    try {
      const sess = await ipc.cuttingBoard.getAllSessions();
      setSessions(sess);
    } catch (err) {
      console.error('[CuttingBoard] getAllSessions error:', err);
    }
    try {
      const tds = await ipc.cuttingBoard.getTrainingDataSummary();
      setTrainingDataSummary(tds);
    } catch (err) {
      console.error('[CuttingBoard] getTrainingDataSummary error:', err);
    }
    try {
      const cr = await ipc.cuttingBoard.getCloudRegistry();
      setCloudRegistry(cr);
    } catch (err) {
      console.error('[CuttingBoard] getCloudRegistry error:', err);
    }
  }, [ipc]);

  useEffect(() => {
    refresh().then(() => setLoaded(true));
    intervalRef.current = setInterval(refresh, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [refresh]);

  const trainModel = useCallback(async () => {
    setTraining(true);
    setPostTrainResult(null);
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

  const dismissPostTrain = useCallback(() => {
    setPostTrainResult(null);
  }, []);

  const deleteSession = useCallback(async (sessionId: number) => {
    await ipc.cuttingBoard.deleteSession(sessionId);
    await refresh();
  }, [ipc, refresh]);

  const nameSession = useCallback(async (sessionId: number, name: string) => {
    await ipc.cuttingBoard.nameSession(sessionId, name);
    await refresh();
  }, [ipc, refresh]);

  return {
    stats, trainingRuns, sessions, trainingDataSummary, training, trainModel, refresh, loaded,
    postTrainResult, cloudRegistry, dismissPostTrain,
    deleteSession, nameSession,
  };
}
