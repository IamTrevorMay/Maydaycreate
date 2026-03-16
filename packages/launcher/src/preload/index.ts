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
  ExportOptions,
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
      currentCommit: string;
      latestCommit: string;
      commitsBehind: number;
    }> => ipcRenderer.invoke('app:checkForUpdates'),
    installUpdate: (): Promise<void> => ipcRenderer.invoke('app:installUpdate'),
    pushVersion: (): Promise<{ commitHash: string; hadChanges: boolean }> =>
      ipcRenderer.invoke('app:pushVersion'),
    relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
    onUpdateProgress: (cb: (progress: { phase: string; message: string; pct: number; done: boolean; error?: string }) => void) => {
      const handler = (_: unknown, progress: { phase: string; message: string; pct: number; done: boolean; error?: string }) => cb(progress);
      ipcRenderer.on('app:updateProgress', handler);
      return () => ipcRenderer.off('app:updateProgress', handler);
    },
  },

  tray: {
    onSync: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on('tray:sync', handler);
      return () => ipcRenderer.off('tray:sync', handler);
    },
  },

  youtube: {
    getVideoInfo: (url: string): Promise<YouTubeVideoInfo> =>
      ipcRenderer.invoke('youtube:getVideoInfo', url),
    startAnalysis: (url: string): Promise<string> =>
      ipcRenderer.invoke('youtube:startAnalysis', url),
    cancelAnalysis: (id: string): Promise<void> =>
      ipcRenderer.invoke('youtube:cancelAnalysis', id),
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
