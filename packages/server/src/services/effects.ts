import type { EffectCaptureResult, EffectApplyResult } from '@mayday/types';
import { BridgeHandler } from '../bridge/handler.js';

export class EffectsService {
  constructor(private bridge: BridgeHandler) {}

  async captureEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<EffectCaptureResult> {
    return await this.bridge.callExtendScript('effects.captureEffects', [trackIndex, clipIndex, trackType]) as EffectCaptureResult;
  }

  async getSelectedClipInfo(): Promise<{ trackIndex: number; clipIndex: number; trackType: 'video' | 'audio'; clipName: string } | null> {
    return await this.bridge.callExtendScript('effects.getSelectedClipInfo') as { trackIndex: number; clipIndex: number; trackType: 'video' | 'audio'; clipName: string } | null;
  }

  async captureFromSelected(): Promise<EffectCaptureResult | null> {
    return await this.bridge.callExtendScript('effects.captureFromSelected') as EffectCaptureResult | null;
  }

  async applyEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio', effectsJson: string): Promise<EffectApplyResult> {
    return await this.bridge.callExtendScript('effects.applyEffects', [trackIndex, clipIndex, trackType, effectsJson]) as EffectApplyResult;
  }

  async removeAllEffects(trackIndex: number, clipIndex: number, trackType: 'video' | 'audio'): Promise<boolean> {
    return await this.bridge.callExtendScript('effects.removeAllEffects', [trackIndex, clipIndex, trackType]) as boolean;
  }

  async listAvailableEffects(): Promise<string[]> {
    return await this.bridge.callExtendScript('effects.listAvailableEffects') as string[];
  }
}
