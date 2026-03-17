import { build } from 'esbuild';

await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'com.mayday.excalibur.sdPlugin/bin/plugin.js',
  external: ['@elgato/streamdeck'],
  minify: false,
  sourcemap: true,
});

console.log('Build complete → com.mayday.excalibur.sdPlugin/bin/plugin.js');
