import { useState, useEffect, useCallback, useRef } from 'react';
import { useIpc } from './useIpc.js';
import type {
  VideoAnalysis,
  VideoAnalysisSummary,
  DetectedEffect,
  ExtractedFrame,
  AnalysisProgress,
  TrainingStats,
  BatchQueueItem,
  ExportOptions,
} from '@mayday/types';

export function useYouTube() {
  const ipc = useIpc();
  const [analyses, setAnalyses] = useState<VideoAnalysisSummary[]>([]);
  const [currentAnalysis, setCurrentAnalysis] = useState<VideoAnalysis | null>(null);
  const [effects, setEffects] = useState<DetectedEffect[]>([]);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [queue, setQueue] = useState<BatchQueueItem[]>([]);
  const [trainingStats, setTrainingStats] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(false);
  const refreshInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshLibrary = useCallback(async () => {
    try {
      const list = await ipc.youtube.listAnalyses();
      setAnalyses(list);
    } catch {}
  }, [ipc]);

  const refreshQueue = useCallback(async () => {
    try {
      const q = await ipc.youtube.getQueue();
      setQueue(q);
    } catch {}
  }, [ipc]);

  const refreshStats = useCallback(async () => {
    try {
      const stats = await ipc.youtube.getTrainingStats();
      setTrainingStats(stats);
    } catch {}
  }, [ipc]);

  // On mount: load library + queue + stats, subscribe to progress
  useEffect(() => {
    refreshLibrary();
    refreshQueue();
    refreshStats();

    const unsub = ipc.youtube.onProgress((p: AnalysisProgress) => {
      setProgress(p);
      if (p.status === 'complete' || p.status === 'error' || p.status === 'cancelled') {
        refreshLibrary();
        refreshQueue();
        refreshStats();
      }
    });

    return unsub;
  }, [ipc, refreshLibrary, refreshQueue, refreshStats]);

  const startAnalysis = useCallback(async (url: string) => {
    setLoading(true);
    try {
      const id = await ipc.youtube.startAnalysis(url);
      await refreshLibrary();
      return id;
    } finally {
      setLoading(false);
    }
  }, [ipc, refreshLibrary]);

  const openAnalysis = useCallback(async (id: string) => {
    const [analysis, efx, frm] = await Promise.all([
      ipc.youtube.getAnalysis(id),
      ipc.youtube.getEffects(id),
      ipc.youtube.getFrames(id),
    ]);
    setCurrentAnalysis(analysis);
    setEffects(efx);
    setFrames(frm);
  }, [ipc]);

  const closeAnalysis = useCallback(() => {
    setCurrentAnalysis(null);
    setEffects([]);
    setFrames([]);
  }, []);

  const rateEffect = useCallback(async (effectId: string, rating: number, correctionNote?: string) => {
    await ipc.youtube.rateEffect(effectId, rating, correctionNote);
    if (currentAnalysis) {
      const efx = await ipc.youtube.getEffects(currentAnalysis.id);
      setEffects(efx);
    }
    refreshStats();
  }, [ipc, currentAnalysis, refreshStats]);

  const saveAsPreset = useCallback(async (effectId: string, name: string, tags?: string[]) => {
    const presetId = await ipc.youtube.saveAsPreset(effectId, name, tags);
    if (currentAnalysis) {
      const efx = await ipc.youtube.getEffects(currentAnalysis.id);
      setEffects(efx);
    }
    return presetId;
  }, [ipc, currentAnalysis]);

  const addToQueue = useCallback(async (url: string, title?: string) => {
    await ipc.youtube.addToQueue(url, title);
    await refreshQueue();
  }, [ipc, refreshQueue]);

  const removeFromQueue = useCallback(async (id: string) => {
    await ipc.youtube.removeFromQueue(id);
    await refreshQueue();
  }, [ipc, refreshQueue]);

  const processQueue = useCallback(async () => {
    await ipc.youtube.processQueue();
  }, [ipc]);

  const deleteAnalysis = useCallback(async (id: string) => {
    await ipc.youtube.deleteAnalysis(id);
    if (currentAnalysis?.id === id) closeAnalysis();
    await refreshLibrary();
  }, [ipc, currentAnalysis, closeAnalysis, refreshLibrary]);

  const cancelAnalysis = useCallback(async (id: string) => {
    await ipc.youtube.cancelAnalysis(id);
  }, [ipc]);

  const exportAnalysis = useCallback(async (options: ExportOptions) => {
    return ipc.youtube.export(options);
  }, [ipc]);

  return {
    analyses,
    currentAnalysis,
    effects,
    frames,
    progress,
    queue,
    trainingStats,
    loading,
    startAnalysis,
    openAnalysis,
    closeAnalysis,
    rateEffect,
    saveAsPreset,
    addToQueue,
    removeFromQueue,
    processQueue,
    deleteAnalysis,
    cancelAnalysis,
    exportAnalysis,
    refreshLibrary,
  };
}
