import { definePlugin } from '@mayday/sdk';
import type { PluginContext, EffectPreset, CapturedEffect } from '@mayday/sdk';
import { randomUUID } from 'crypto';
import { savePreset, loadPreset, deletePreset, listPresets, loadIndex } from './storage.js';
import { generateExcaliburGuide, generateAHKScript, generateKeyboardMaestro } from './excalibur.js';
import type { PresetSaveOptions, PresetApplyOptions, PresetListFilter } from './types.js';

function storageDir(ctx: PluginContext): string {
  return ctx.dataDir;
}

export default definePlugin({
  async activate(ctx) {
    // Ensure storage directories exist on activation
    const fs = await import('fs');
    const path = await import('path');
    const presetsDir = path.join(storageDir(ctx), 'presets');
    if (!fs.existsSync(presetsDir)) {
      fs.mkdirSync(presetsDir, { recursive: true });
    }
    ctx.log.info('Preset Vault activated');
  },

  commands: {
    async capture(ctx, args) {
      const opts = (args ?? {}) as PresetSaveOptions;
      if (!opts.name) throw new Error('Preset name is required');

      const captureResult = await ctx.services.effects.captureFromSelected();
      if (!captureResult) throw new Error('No clip selected or capture failed');

      const includeIntrinsics = opts.includeIntrinsics ?? false;
      let effects: CapturedEffect[] = captureResult.effects;
      if (!includeIntrinsics) {
        effects = effects.filter(e => !e.isIntrinsic);
      }

      if (effects.length === 0) {
        throw new Error('No effects found on selected clip');
      }

      const now = new Date().toISOString();
      const preset: EffectPreset = {
        id: randomUUID(),
        name: opts.name,
        version: 1,
        tags: opts.tags ?? [],
        folder: opts.folder ?? '',
        description: opts.description ?? '',
        sourceClipName: captureResult.clipName,
        includeIntrinsics,
        createdAt: now,
        updatedAt: now,
        effects,
      };

      const entry = savePreset(storageDir(ctx), preset);

      ctx.ui.showToast(`Captured "${preset.name}" (${entry.effectCount} effects)`, 'success');
      ctx.ui.pushToPanel('preset-saved', entry);

      return entry;
    },

    async apply(ctx, args) {
      const opts = (args ?? {}) as PresetApplyOptions;
      if (!opts.presetId) throw new Error('presetId is required');

      const preset = loadPreset(storageDir(ctx), opts.presetId);
      if (!preset) throw new Error(`Preset not found: ${opts.presetId}`);

      const clipInfo = await ctx.services.effects.getSelectedClipInfo();
      if (!clipInfo) throw new Error('No clip selected');

      if (opts.clearExisting) {
        await ctx.services.effects.removeAllEffects(
          clipInfo.trackIndex,
          clipInfo.clipIndex,
          clipInfo.trackType,
        );
      }

      const result = await ctx.services.effects.applyEffects(
        clipInfo.trackIndex,
        clipInfo.clipIndex,
        clipInfo.trackType,
        JSON.stringify(preset.effects),
      );

      const msg = `Applied "${preset.name}": ${result.applied.length} applied, ${result.skipped.length} skipped, ${result.errors.length} errors`;
      ctx.ui.showToast(msg, result.errors.length > 0 ? 'warning' : 'success');

      return result;
    },

    async list(ctx, args) {
      const filter = (args ?? {}) as PresetListFilter;
      return listPresets(storageDir(ctx), filter);
    },

    async 'delete-preset'(ctx, args) {
      const { presetId } = (args ?? {}) as { presetId?: string };
      if (!presetId) throw new Error('presetId is required');

      const deleted = deletePreset(storageDir(ctx), presetId);
      if (!deleted) throw new Error(`Preset not found: ${presetId}`);

      ctx.ui.showToast('Preset deleted', 'info');
      ctx.ui.pushToPanel('preset-deleted', { presetId });

      return { deleted: true };
    },

    async 'export-excalibur'(ctx, args) {
      const { format } = (args ?? {}) as { format?: string };
      const index = loadIndex(storageDir(ctx));
      const presets = index.presets;

      if (presets.length === 0) {
        throw new Error('No presets to export');
      }

      switch (format) {
        case 'ahk':
          return { format: 'ahk', content: generateAHKScript(presets) };
        case 'keyboard-maestro':
          return { format: 'keyboard-maestro', content: generateKeyboardMaestro(presets) };
        case 'excalibur':
        default:
          return { format: 'excalibur', content: generateExcaliburGuide(presets) };
      }
    },

    async 'save-synthetic'(ctx, args) {
      const { preset } = (args ?? {}) as { preset?: EffectPreset };
      if (!preset) throw new Error('preset object is required');
      if (!preset.id || !preset.name) throw new Error('preset must have id and name');

      const entry = savePreset(storageDir(ctx), preset);
      ctx.log.info(`Saved synthetic preset "${preset.name}" (${entry.effectCount} effects)`);
      ctx.ui.pushToPanel('preset-saved', entry);
      return entry;
    },

    async 'clear-effects'(ctx) {
      const clipInfo = await ctx.services.effects.getSelectedClipInfo();
      if (!clipInfo) throw new Error('No clip selected');

      await ctx.services.effects.removeAllEffects(
        clipInfo.trackIndex,
        clipInfo.clipIndex,
        clipInfo.trackType,
      );

      ctx.ui.showToast(`Cleared effects from "${clipInfo.clipName}"`, 'success');
      return { cleared: true, clipName: clipInfo.clipName };
    },
  },
});
