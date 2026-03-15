import { definePlugin } from '@mayday/sdk';

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Hello World plugin activated!');
  },

  async deactivate(ctx) {
    ctx.log.info('Hello World plugin deactivated');
  },

  commands: {
    info: async (ctx) => {
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence', 'warning');
        return null;
      }

      const message = `${seq.name} — ${seq.videoTracks.length}V/${seq.audioTracks.length}A tracks, ${seq.duration.toFixed(1)}s`;
      ctx.log.info(message);
      ctx.ui.showToast(message, 'success');
      return { name: seq.name, duration: seq.duration, tracks: seq.videoTracks.length + seq.audioTracks.length };
    },

    markers: async (ctx) => {
      const markers = await ctx.services.timeline.getMarkers();
      if (markers.length === 0) {
        ctx.ui.showToast('No markers found', 'info');
        return [];
      }

      const summary = markers.map(m => `${m.name} @ ${m.start.toFixed(1)}s`).join(', ');
      ctx.ui.showToast(`${markers.length} markers: ${summary}`, 'info');
      return markers;
    },
  },
});
