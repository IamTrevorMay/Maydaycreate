import { definePlugin } from '@mayday/sdk';
import type { SilentRegion } from '@mayday/sdk';

let detectedRegions: SilentRegion[] = [];

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Silence Remover activated');
    detectedRegions = [];
  },

  commands: {
    analyze: async (ctx) => {
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence', 'warning');
        return;
      }

      // Find the first audio clip to analyze
      const audioClips = await ctx.services.timeline.getClips(0, 'audio');
      if (audioClips.length === 0) {
        ctx.ui.showToast('No audio clips found', 'warning');
        return;
      }

      const firstClip = audioClips[0];
      if (!firstClip.mediaPath) {
        ctx.ui.showToast('Clip has no media path', 'error');
        return;
      }

      ctx.ui.showProgress('Analyzing audio...', 0);
      ctx.log.info(`Analyzing: ${firstClip.mediaPath}`);

      const threshold = (ctx.config.threshold as number) ?? -30;
      const minDuration = (ctx.config.minDuration as number) ?? 0.5;

      try {
        const regions = await ctx.services.media.detectSilence(firstClip.mediaPath, {
          threshold,
          minDuration,
        });

        detectedRegions = regions;

        ctx.ui.showProgress('Adding markers...', 50);

        // Add markers for each silent region
        for (let i = 0; i < regions.length; i++) {
          const region = regions[i];
          await ctx.services.timeline.addMarker(
            region.start,
            `Silence ${i + 1}`,
            'red',
            `${region.duration.toFixed(1)}s silent (${threshold}dB threshold)`
          );
          ctx.ui.showProgress('Adding markers...', 50 + (50 * (i + 1)) / regions.length);
        }

        ctx.ui.hideProgress();
        ctx.ui.showToast(
          `Found ${regions.length} silent region(s), total ${regions.reduce((sum, r) => sum + r.duration, 0).toFixed(1)}s`,
          'success'
        );

        // Store results for potential AI analysis
        await ctx.data.set('lastAnalysis', {
          clipPath: firstClip.mediaPath,
          regions,
          threshold,
          timestamp: Date.now(),
        });

        return regions;
      } catch (err) {
        ctx.ui.hideProgress();
        ctx.ui.showToast(`Analysis failed: ${err}`, 'error');
        ctx.log.error('Analysis failed:', err);
      }
    },

    remove: async (ctx) => {
      if (detectedRegions.length === 0) {
        ctx.ui.showToast('Run "Analyze Silence" first', 'warning');
        return;
      }

      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence', 'warning');
        return;
      }

      ctx.ui.showToast(`Would remove ${detectedRegions.length} silent regions. (Preview mode — full removal requires ripple edit support)`, 'info');
      ctx.log.info(`Detected ${detectedRegions.length} regions for removal`);

      return { regionsCount: detectedRegions.length, regions: detectedRegions };
    },

    'clear-markers': async (ctx) => {
      detectedRegions = [];
      ctx.ui.showToast('Silence markers cleared', 'info');
      return true;
    },
  },
});
