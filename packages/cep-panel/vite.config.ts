import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../../dist/cep/client',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: 'index.html',
        training: 'training.html',
        streamdeck: 'streamdeck.html',
      },
    },
  },
  server: {
    port: 5173,
  },
});
