import type { Sequence, Clip, Marker, ProjectBinItem } from '@mayday/types';
import { BridgeHandler } from '../bridge/handler.js';

export class TimelineService {
  constructor(private bridge: BridgeHandler) {}

  async getActiveSequence(): Promise<Sequence | null> {
    return await this.bridge.callExtendScript('timeline.getActiveSequence') as Sequence | null;
  }

  async getClips(trackIndex?: number, trackType?: 'video' | 'audio'): Promise<Clip[]> {
    return await this.bridge.callExtendScript('timeline.getClips', [trackIndex, trackType]) as Clip[];
  }

  async addMarker(time: number, name: string, color?: string, comment?: string): Promise<void> {
    await this.bridge.callExtendScript('markers.addMarker', [time, name, color, comment]);
  }

  async getMarkers(): Promise<Marker[]> {
    return await this.bridge.callExtendScript('markers.getMarkers') as Marker[];
  }

  async removeClip(trackIndex: number, clipIndex: number, trackType?: 'video' | 'audio'): Promise<void> {
    await this.bridge.callExtendScript('timeline.removeClip', [trackIndex, clipIndex, trackType]);
  }

  async setClipInOutPoints(trackIndex: number, clipIndex: number, trackType: string, inPoint: number, outPoint: number): Promise<void> {
    await this.bridge.callExtendScript('timeline.setClipInOutPoints', [trackIndex, clipIndex, trackType, inPoint, outPoint]);
  }

  async getPlayheadPosition(): Promise<number> {
    return await this.bridge.callExtendScript('timeline.getPlayheadPosition') as number;
  }

  async setPlayheadPosition(time: number): Promise<void> {
    await this.bridge.callExtendScript('timeline.setPlayheadPosition', [time]);
  }

  async splitClip(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', splitTimeSeconds: number): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.splitClip', [trackIndex, clipIndex, trackType, splitTimeSeconds]) as boolean;
  }

  async insertClip(trackIndex: number, trackType: 'video' | 'audio', projectItemPath: string, timeInSeconds: number): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.insertClip', [trackIndex, trackType, projectItemPath, timeInSeconds]) as boolean;
  }

  async overwriteClip(trackIndex: number, trackType: 'video' | 'audio', projectItemPath: string, timeInSeconds: number): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.overwriteClip', [trackIndex, trackType, projectItemPath, timeInSeconds]) as boolean;
  }

  async rippleDelete(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.rippleDelete', [trackIndex, clipIndex, trackType]) as boolean;
  }

  async liftClip(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.liftClip', [trackIndex, clipIndex, trackType]) as boolean;
  }

  async setClipEnabled(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', enabled: boolean): Promise<boolean> {
    return await this.bridge.callExtendScript('timeline.setClipEnabled', [trackIndex, clipIndex, trackType, enabled]) as boolean;
  }

  async getProjectBinItems(): Promise<ProjectBinItem[]> {
    return await this.bridge.callExtendScript('timeline.getProjectBinItems') as ProjectBinItem[];
  }

  async duplicateSequence(): Promise<{ originalName: string; backupName: string } | null> {
    return await this.bridge.callExtendScript('timeline.duplicateSequence') as { originalName: string; backupName: string } | null;
  }
}
