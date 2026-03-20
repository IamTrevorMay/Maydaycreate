import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import type { CutFinder } from './cut-finder.js';
import type { CutFinderExportOptions } from '@mayday/types';

export function registerCutFinderHandlers(finder: CutFinder, win: BrowserWindow): void {
  finder.onProgress((progress) => {
    if (!win.isDestroyed()) {
      win.webContents.send('cutFinder:progress', progress);
    }
  });

  ipcMain.handle('cutFinder:getVideoInfo', async (_e, url: string) => {
    return finder.getVideoInfo(url);
  });

  ipcMain.handle('cutFinder:startAnalysis', async (_e, url: string) => {
    return finder.startAnalysis(url);
  });

  ipcMain.handle('cutFinder:cancelAnalysis', (_e, id: string) => {
    finder.cancelAnalysis(id);
  });

  ipcMain.handle('cutFinder:pauseAnalysis', (_e, id: string) => {
    finder.pauseAnalysis(id);
  });

  ipcMain.handle('cutFinder:resumeAnalysis', async (_e, id: string) => {
    await finder.resumeAnalysis(id);
  });

  ipcMain.handle('cutFinder:getAnalysis', (_e, id: string) => {
    return finder.getAnalysis(id);
  });

  ipcMain.handle('cutFinder:listAnalyses', () => {
    return finder.listAnalyses();
  });

  ipcMain.handle('cutFinder:deleteAnalysis', (_e, id: string) => {
    return finder.deleteAnalysis(id);
  });

  ipcMain.handle('cutFinder:getCuts', (_e, analysisId: string) => {
    return finder.getCuts(analysisId);
  });

  ipcMain.handle('cutFinder:getFrames', (_e, analysisId: string) => {
    return finder.getFrames(analysisId);
  });

  ipcMain.handle('cutFinder:export', (_e, options: CutFinderExportOptions) => {
    return finder.exportAnalysis(options);
  });

  ipcMain.handle('cutFinder:setIntentTags', (_e, cutId: string, tags: string[]) => {
    finder.setIntentTags(cutId, tags);
  });
}
