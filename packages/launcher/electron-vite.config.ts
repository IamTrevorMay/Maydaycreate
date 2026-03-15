import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [
          'better-sqlite3',
          'node-global-key-listener',
          '@mayday/server',
          '@mayday/sync-engine',
          'yt-dlp-wrap',
          '@anthropic-ai/sdk',
          'ws',
          'bufferutil',
          'utf-8-validate',
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@mayday/ui-kit': resolve(__dirname, '../ui-kit/src/index.ts'),
        '@renderer': resolve('src/renderer'),
      },
    },
  },
});
