import { definePlugin } from '@mayday/sdk';
import type { PluginContext } from '@mayday/sdk';

export default definePlugin({
  async activate(ctx: PluginContext) {
    ctx.log.info('Plugin activated!');
  },

  async deactivate(ctx: PluginContext) {
    ctx.log.info('Plugin deactivated');
  },

  commands: {
    hello: async (ctx: PluginContext) => {
      const seq = await ctx.services.timeline.getActiveSequence();
      const greeting = ctx.config.greeting as string ?? 'Hello!';
      const message = seq
        ? `${greeting} Active sequence: ${seq.name}`
        : `${greeting} No active sequence.`;

      ctx.ui.showToast(message, 'info');
      return { message };
    },
  },
});
