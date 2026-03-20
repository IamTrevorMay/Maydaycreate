import { contextBridge, ipcRenderer } from 'electron';
import type { LauncherConfig } from '../main/config-store.js';
import type {
  SyncStatus,
  SyncConflict,
  SyncLogEntry,
  ConflictResolution,
  HistorySnapshot,
  OfflineQueueEntry,
  MigrationProgress,
} from '@mayday/sync-engine';
import type {
  ServerStatus,
  LauncherPluginInfo,
  YouTubeVideoInfo,
  VideoAnalysis,
  VideoAnalysisSummary,
  DetectedEffect,
  ExtractedFrame,
  TrainingStats,
  BatchQueueItem,
  AnalysisProgress,
  AnalysisOptions,
  ExportOptions,
  CuttingBoardAggregateStats,
  CuttingBoardTrainingRun,
  CuttingBoardJoinResult,
  CutFinderProgress,
  CutFinderAnalysis,
  CutFinderAnalysisSummary,
  DetectedCut,
  CutFinderExportOptions,
} from '@mayday/types';

const mayday = {
  plugins: {
    getAll: (): Promise<LauncherPluginInfo[]> => ipcRenderer.invoke('plugins:getAll'),
    enable: (id: string): Promise<void> => ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string): Promise<void> => ipcRenderer.invoke('plugins:disable', id),
    install: (sourcePath: string): Promise<unknown> => ipcRenderer.invoke('plugins:install', sourcePath),
    onChanged: (cb: (plugins: LauncherPluginInfo[]) => void) => {
      const handler = (_: unknown, plugins: LauncherPluginInfo[]) => cb(plugins);
      ipcRenderer.on('plugins:changed', handler);
      return () => ipcRenderer.off('plugins:changed', handler);
    },
  },

  server: {
    getStatus: (): Promise<ServerStatus> => ipcRenderer.invoke('server:getStatus'),
    onStatus: (cb: (status: ServerStatus) => void) => {
      const handler = (_: unknown, status: ServerStatus) => cb(status);
      ipcRenderer.on('server:statusChanged', handler);
      return () => ipcRenderer.off('server:statusChanged', handler);
    },
  },

  sync: {
    getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:getStatus'),
    runSync: (): Promise<void> => ipcRenderer.invoke('sync:runSync'),
    getConflicts: (): Promise<SyncConflict[]> => ipcRenderer.invoke('sync:getConflicts'),
    resolveConflict: (resolution: ConflictResolution): Promise<void> =>
      ipcRenderer.invoke('sync:resolveConflict', resolution),
    getSyncLog: (): Promise<SyncLogEntry[]> => ipcRenderer.invoke('sync:getSyncLog'),
    getQueue: (): Promise<OfflineQueueEntry[]> => ipcRenderer.invoke('sync:getQueue'),
    flushQueue: (): Promise<void> => ipcRenderer.invoke('sync:flushQueue'),
    onStatusChanged: (cb: (status: SyncStatus) => void) => {
      const handler = (_: unknown, status: SyncStatus) => cb(status);
      ipcRenderer.on('sync:statusChanged', handler);
      return () => ipcRenderer.off('sync:statusChanged', handler);
    },
  },

  history: {
    list: (): Promise<HistorySnapshot[]> => ipcRenderer.invoke('history:list'),
    createSnapshot: (): Promise<HistorySnapshot> => ipcRenderer.invoke('history:createSnapshot'),
    restore: (snapshot: HistorySnapshot): Promise<void> =>
      ipcRenderer.invoke('history:restore', snapshot),
  },

  config: {
    get: (): Promise<LauncherConfig> => ipcRenderer.invoke('config:get'),
    setSyncSourcePath: (newPath: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setSyncSourcePath', newPath),
    setAutoLaunch: (enabled: boolean): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setAutoLaunch', enabled),
    setAnthropicApiKey: (key: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setAnthropicApiKey', key),
    setSupabaseUrl: (url: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setSupabaseUrl', url),
    setSupabaseAnonKey: (key: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setSupabaseAnonKey', key),
    setAutoUpdate: (enabled: boolean): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setAutoUpdate', enabled),
    setGhToken: (token: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:setGhToken', token),
    migrateSyncSource: (oldPath: string, newPath: string): Promise<LauncherConfig> =>
      ipcRenderer.invoke('config:migrateSyncSource', oldPath, newPath),
    onMigrationProgress: (cb: (progress: MigrationProgress) => void) => {
      const handler = (_: unknown, progress: MigrationProgress) => cb(progress);
      ipcRenderer.on('config:migrationProgress', handler);
      return () => ipcRenderer.off('config:migrationProgress', handler);
    },
  },

  dialog: {
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
    openPlugin: (): Promise<string | null> => ipcRenderer.invoke('dialog:openPlugin'),
  },

  app: {
    getVersion: (): Promise<{ version: string; name: string }> =>
      ipcRenderer.invoke('app:getVersion'),
    checkForUpdates: (): Promise<{
      updateAvailable: boolean;
      currentVersion: string;
      latestVersion: string;
    }> => ipcRenderer.invoke('app:checkForUpdates'),
    installUpdate: (): Promise<void> => ipcRenderer.invoke('app:installUpdate'),
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke('app:downloadUpdate'),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('app:quitAndInstall'),
    pushVersion: (): Promise<{ commitHash: string; hadChanges: boolean; publishedVersion: string }> =>
      ipcRenderer.invoke('app:pushVersion'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    onUpdateProgress: (cb: (progress: { phase: string; message: string; pct: number; done: boolean; error?: string }) => void) => {
      const handler = (_: unknown, progress: { phase: string; message: string; pct: number; done: boolean; error?: string }) => cb(progress);
      ipcRenderer.on('app:updateProgress', handler);
      return () => ipcRenderer.off('app:updateProgress', handler);
    },
    onAutoUpdateStatus: (cb: (status: { state: string; message?: string }) => void) => {
      const handler = (_: unknown, status: { state: string; message?: string }) => cb(status);
      ipcRenderer.on('app:autoUpdateStatus', handler);
      return () => ipcRenderer.off('app:autoUpdateStatus', handler);
    },
  },

  tray: {
    onSync: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('tray:sync', handler);
      return () => ipcRenderer.off('tray:sync', handler);
    },
  },

  cuttingBoard: {
    getAggregateStats: (): Promise<CuttingBoardAggregateStats | null> =>
      ipcRenderer.invoke('cuttingBoard:getAggregateStats'),
    getTrainingRuns: (): Promise<CuttingBoardTrainingRun[]> =>
      ipcRenderer.invoke('cuttingBoard:getTrainingRuns'),
    trainModel: (): Promise<unknown> =>
      ipcRenderer.invoke('cuttingBoard:trainModel'),
    joinModels: (videoId: string): Promise<CuttingBoardJoinResult> =>
      ipcRenderer.invoke('cuttingBoard:joinModels', videoId),
  },

  cutFinder: {
    startAnalysis: (url: string): Promise<string> =>
      ipcRenderer.invoke('cutFinder:startAnalysis', url),
    cancelAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('cutFinder:cancelAnalysis', id),
    pauseAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('cutFinder:pauseAnalysis', id),
    resumeAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('cutFinder:resumeAnalysis', id),
    getAnalysis: (id: string): Promise<CutFinderAnalysis | null> =>
      ipcRenderer.invoke('cutFinder:getAnalysis', id),
    listAnalyses: (): Promise<CutFinderAnalysisSummary[]> =>
      ipcRenderer.invoke('cutFinder:listAnalyses'),
    deleteAnalysis: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('cutFinder:deleteAnalysis', id),
    getCuts: (analysisId: string): Promise<DetectedCut[]> =>
      ipcRenderer.invoke('cutFinder:getCuts', analysisId),
    getFrames: (analysisId: string): Promise<ExtractedFrame[]> =>
      ipcRenderer.invoke('cutFinder:getFrames', analysisId),
    setIntentTags: (cutId: string, tags: string[]): Promise<void> =>
      ipcRenderer.invoke('cutFinder:setIntentTags', cutId, tags),
    export: (options: CutFinderExportOptions): Promise<string> =>
      ipcRenderer.invoke('cutFinder:export', options),
    onProgress: (cb: (progress: CutFinderProgress) => void) => {
      const handler = (_: unknown, progress: CutFinderProgress) => cb(progress);
      ipcRenderer.on('cutFinder:progress', handler);
      return () => ipcRenderer.off('cutFinder:progress', handler);
    },
  },

  youtube: {
    getVideoInfo: (url: string): Promise<YouTubeVideoInfo> =>
      ipcRenderer.invoke('youtube:getVideoInfo', url),
    startAnalysis: (url: string, options?: AnalysisOptions): Promise<string> =>
      ipcRenderer.invoke('youtube:startAnalysis', url, options),
    cancelAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('youtube:cancelAnalysis', id),
    pauseAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('youtube:pauseAnalysis', id),
    resumeAnalysis: (id: string, options?: AnalysisOptions): Promise<void> =>
      ipcRenderer.invoke('youtube:resumeAnalysis', id, options),
    getAnalysis: (id: string): Promise<VideoAnalysis | null> =>
      ipcRenderer.invoke('youtube:getAnalysis', id),
    listAnalyses: (): Promise<VideoAnalysisSummary[]> =>
      ipcRenderer.invoke('youtube:listAnalyses'),
    deleteAnalysis: (id: string): Promise<boolean> =>
      ipcRenderer.invoke('youtube:deleteAnalysis', id),
    getEffects: (analysisId: string): Promise<DetectedEffect[]> =>
      ipcRenderer.invoke('youtube:getEffects', analysisId),
    getFrames: (analysisId: string): Promise<ExtractedFrame[]> =>
      ipcRenderer.invoke('youtube:getFrames', analysisId),
    rateEffect: (effectId: string, rating: number, correctionNote?: string): Promise<void> =>
      ipcRenderer.invoke('youtube:rateEffect', effectId, rating, correctionNote),
    saveAsPreset: (effectId: string, name: string, tags?: string[]): Promise<string> =>
      ipcRenderer.invoke('youtube:saveAsPreset', effectId, name, tags),
    addToQueue: (url: string, title?: string): Promise<string> =>
      ipcRenderer.invoke('youtube:addToQueue', url, title),
    removeFromQueue: (id: string): Promise<void> =>
      ipcRenderer.invoke('youtube:removeFromQueue', id),
    getQueue: (): Promise<BatchQueueItem[]> =>
      ipcRenderer.invoke('youtube:getQueue'),
    processQueue: (): Promise<void> =>
      ipcRenderer.invoke('youtube:processQueue'),
    getTrainingStats: (): Promise<TrainingStats> =>
      ipcRenderer.invoke('youtube:getTrainingStats'),
    export: (options: ExportOptions): Promise<string> =>
      ipcRenderer.invoke('youtube:export', options),
    onProgress: (cb: (progress: AnalysisProgress) => void) => {
      const handler = (_: unknown, progress: AnalysisProgress) => cb(progress);
      ipcRenderer.on('youtube:progress', handler);
      return () => ipcRenderer.off('youtube:progress', handler);
    },
  },
};

contextBridge.exposeInMainWorld('mayday', mayday);

export type MaydayAPI = typeof mayday;
