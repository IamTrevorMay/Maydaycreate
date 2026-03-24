import { definePlugin } from '@mayday/sdk';

/**
 * Stream Deck & Excalibur plugin.
 *
 * Hardware integration is currently handled by the server's built-in services:
 *   - packages/server/src/services/streamdeck-hardware.ts (USB HID polling)
 *   - packages/server/src/services/streamdeck-config.ts (button layout persistence)
 *   - packages/server/src/services/streamdeck-worker-manager.ts (child process management)
 *   - packages/server/src/services/excalibur-executor.ts (ExtendScript execution)
 *
 * This manifest registers the plugin in the marketplace. The services
 * will be migrated into activate()/deactivate() in a future iteration
 * once the plugin API supports low-level hardware access.
 */
export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Stream Deck & Excalibur plugin activated (services hosted in server core)');
  },
});
