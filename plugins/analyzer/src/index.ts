import { definePlugin } from '@mayday/sdk';

/**
 * Analyzer plugin — YouTube video effect analysis.
 *
 * The UI for this plugin currently lives in the launcher renderer
 * (packages/launcher/src/renderer/pages/YouTubePage.tsx) and is
 * registered as a "core plugin" page. The backend lives in the
 * launcher main process (packages/launcher/src/main/youtube/).
 *
 * This manifest enables the plugin to appear in the marketplace
 * and get a dynamic sidebar entry. A future migration will move
 * the UI into this plugin's directory.
 */
export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Analyzer plugin activated (UI hosted in launcher)');
  },
});
