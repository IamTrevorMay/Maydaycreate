import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { YouTubeAnalyzer } from './youtube-analyzer.js';
import type { ExportOptions } from '@mayday/types';

export function registerYouTubeHandlers(analyzer: YouTubeAnalyzer, win: BrowserWindow): void {
  // Push progress events to renderer
  analyzer.onProgress((progress) => {
    if (!win.isDestroyed()) {
      win.webContents.send('youtube:progress', progress);
    }
  });

  ipcMain.handle('youtube:getVideoInfo', async (_e, url: string) => {
    return analyzer.getVideoInfo(url);
  });

  ipcMain.handle('youtube:startAnalysis', async (_e, url: string) => {
    return analyzer.startAnalysis(url);
  });

  ipcMain.handle('youtube:cancelAnalysis', (_e, id: string) => {
    analyzer.cancelAnalysis(id);
  });

  ipcMain.handle('youtube:getAnalysis', (_e, id: string) => {
    return analyzer.getAnalysis(id);
  });

  ipcMain.handle('youtube:listAnalyses', () => {
    return analyzer.listAnalyses();
  });

  ipcMain.handle('youtube:deleteAnalysis', (_e, id: string) => {
    return analyzer.deleteAnalysis(id);
  });

  ipcMain.handle('youtube:getEffects', (_e, analysisId: string) => {
    return analyzer.getEffects(analysisId);
  });

  ipcMain.handle('youtube:getFrames', (_e, analysisId: string) => {
    return analyzer.getFrames(analysisId);
  });

  ipcMain.handle('youtube:rateEffect', (_e, effectId: string, rating: number, correctionNote?: string) => {
    analyzer.rateEffect(effectId, rating, correctionNote);
  });

  ipcMain.handle('youtube:saveAsPreset', async (_e, effectId: string, name: string, tags?: string[]) => {
    return analyzer.saveEffectAsPreset(effectId, name, tags);
  });

  ipcMain.handle('youtube:addToQueue', (_e, url: string, title?: string) => {
    return analyzer.addToQueue(url, title);
  });

  ipcMain.handle('youtube:removeFromQueue', (_e, id: string) => {
    analyzer.removeFromQueue(id);
  });

  ipcMain.handle('youtube:getQueue', () => {
    return analyzer.getQueue();
  });

  ipcMain.handle('youtube:processQueue', async () => {
    await analyzer.processQueue();
  });

  ipcMain.handle('youtube:getTrainingStats', () => {
    return analyzer.getTrainingStats();
  });

  ipcMain.handle('youtube:export', (_e, options: ExportOptions) => {
    return analyzer.exportAnalysis(options);
  });
}
