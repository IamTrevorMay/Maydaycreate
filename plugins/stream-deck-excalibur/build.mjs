import { build } from 'esbuild';

await build({
  entryPoints: ['src/plugin.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'com.mayday.excalibur.sdPlugin/bin/plugin.js',
  external: ['fs', 'path', 'os', 'child_process', 'crypto', 'events', 'stream', 'util', 'net', 'http', 'https', 'url', 'node:*'],
  minify: false,
  sourcemap: true,
});

console.log('Build complete → com.mayday.excalibur.sdPlugin/bin/plugin.js');
