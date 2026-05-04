/**
 * Postinstall script: rebuilds better-sqlite3 for Electron's ABI.
 *
 * System Node and Electron use different ABI versions (e.g. Node 22 = ABI 137,
 * Electron 31 = ABI 125). After `npm install`, the native binary is built for
 * system Node, which crashes Electron at runtime. This script fixes that
 * automatically.
 *
 * Skipped in CI when electron-builder handles the rebuild itself (ELECTRON_BUILDER=true).
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ELECTRON_VERSION = '31.7.7';

// Skip if electron-builder is handling the rebuild
if (process.env.ELECTRON_BUILDER === 'true') {
  console.log('[postinstall] Skipping better-sqlite3 rebuild (electron-builder handles it)');
  process.exit(0);
}

const sqlite3Dir = path.join(__dirname, '..', 'node_modules', 'better-sqlite3');

if (!fs.existsSync(sqlite3Dir)) {
  console.log('[postinstall] better-sqlite3 not found, skipping rebuild');
  process.exit(0);
}

console.log(`[postinstall] Rebuilding better-sqlite3 for Electron ${ELECTRON_VERSION}...`);

try {
  execSync(`npx prebuild-install -r electron -t ${ELECTRON_VERSION}`, {
    cwd: sqlite3Dir,
    stdio: 'inherit',
  });
  console.log('[postinstall] better-sqlite3 rebuilt successfully for Electron');
} catch (e) {
  // prebuild-install may fail if no prebuilt binary exists for this combo.
  // Fall back to node-gyp rebuild.
  console.log('[postinstall] Prebuilt binary not available, trying node-gyp rebuild...');
  try {
    execSync(
      `npx node-gyp rebuild --target=${ELECTRON_VERSION} --arch=arm64 --dist-url=https://electronjs.org/headers`,
      { cwd: sqlite3Dir, stdio: 'inherit' }
    );
    console.log('[postinstall] better-sqlite3 rebuilt via node-gyp for Electron');
  } catch (e2) {
    console.error('[postinstall] Failed to rebuild better-sqlite3:', e2.message);
    console.error('[postinstall] Run manually: cd node_modules/better-sqlite3 && npx prebuild-install -r electron -t ' + ELECTRON_VERSION);
    process.exit(1);
  }
}
