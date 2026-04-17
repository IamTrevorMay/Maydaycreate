import { definePlugin } from '@mayday/sdk';
import type { PluginContext } from '@mayday/sdk';
import type { PathGuardStatus } from './types.js';

let scanning = false;

export default definePlugin({
  async activate(ctx) {
    // Ensure symlink root directory exists
    const fs = await import('fs');
    const path = await import('path');
    const os = await import('os');

    const symlinkRoot = (ctx.config.symlinkRoot as string ?? '~/MaydayMedia/pathguard')
      .replace(/^~/, os.homedir());

    if (!fs.existsSync(symlinkRoot)) {
      fs.mkdirSync(symlinkRoot, { recursive: true });
    }

    // Ensure data directory exists
    if (!fs.existsSync(ctx.dataDir)) {
      fs.mkdirSync(ctx.dataDir, { recursive: true });
    }

    ctx.log.info(`PathGuard activated — symlink root: ${symlinkRoot}`);
  },

  commands: {
    'scan-project': async (ctx) => {
      // Stub — will be implemented in Build Step 2-3
      ctx.log.info('scan-project called (stub)');
      return { newItems: [], totalItems: 0, managedItems: 0 };
    },

    'get-status': async (ctx) => {
      const status: PathGuardStatus = {
        scanning,
        projectPath: null,
        managedCount: 0,
        brokenCount: 0,
        daemonRunning: false,
        lastScan: null,
      };
      return status;
    },

    'reconcile': async (ctx) => {
      // Stub — will be implemented in Build Step 7
      ctx.log.info('reconcile called (stub)');
      return { checked: 0, valid: 0, repaired: 0, broken: 0, brokenFiles: [] };
    },
  },
});
