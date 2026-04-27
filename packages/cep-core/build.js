/**
 * Mayday Core CEP Extension — Build Script
 *
 * Builds the core CEP extension by:
 * 1. Copying client files (bridge.html, CSInterface.js)
 * 2. Copying the CSXS manifest
 * 3. Building the ExtendScript bundle (reuses packages/extendscript/build.js output)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CORE_DIR = __dirname;
const DIST_DIR = path.join(ROOT, 'dist', 'cep-core');

// Ensure dist directories exist
fs.mkdirSync(path.join(DIST_DIR, 'client', 'lib'), { recursive: true });
fs.mkdirSync(path.join(DIST_DIR, 'CSXS'), { recursive: true });
fs.mkdirSync(path.join(DIST_DIR, 'host'), { recursive: true });

// 1. Copy client files
fs.copyFileSync(
  path.join(CORE_DIR, 'client', 'bridge.html'),
  path.join(DIST_DIR, 'client', 'bridge.html'),
);
fs.copyFileSync(
  path.join(CORE_DIR, 'client', 'lib', 'CSInterface.js'),
  path.join(DIST_DIR, 'client', 'lib', 'CSInterface.js'),
);

// 2. Copy CSXS manifest
fs.copyFileSync(
  path.join(CORE_DIR, 'CSXS', 'manifest.xml'),
  path.join(DIST_DIR, 'CSXS', 'manifest.xml'),
);

// 3. Build ExtendScript bundle (same as main cep-panel)
const ES_SRC = path.join(ROOT, 'packages', 'extendscript', 'src');
const files = [
  'json2.jsx', 'utils.jsx', 'project.jsx', 'timeline.jsx',
  'markers.jsx', 'effects.jsx', 'sequence.jsx', 'exports.jsx',
  'preferences.jsx', 'bridge.jsx', 'index.jsx',
];

let output = '// Mayday Core - ExtendScript Bundle\n// Auto-generated - do not edit\n\n';

for (const file of files) {
  const filePath = path.join(ES_SRC, file);
  if (!fs.existsSync(filePath)) {
    console.error('Missing ExtendScript source file: ' + filePath);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  output += '// === ' + file + ' ===\n' + content + '\n\n';
}

fs.writeFileSync(path.join(DIST_DIR, 'host', 'index.jsx'), output);

console.log('Mayday Core CEP extension built to dist/cep-core/');
