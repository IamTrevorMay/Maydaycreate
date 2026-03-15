import { startServer } from './server.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

export { startServer };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '../../..');

// Only auto-start when run directly (not imported by the launcher)
const thisFile = fileURLToPath(import.meta.url).replace(/\.js$/, '');
const entryFile = process.argv[1] ? path.resolve(process.argv[1]).replace(/\.js$/, '') : '';
const isDirectRun = entryFile !== '' && thisFile === entryFile;
if (isDirectRun) {
  dotenv.config({ path: path.join(rootDir, '.env') });

  const port = parseInt(process.env.MAYDAY_PORT || '9876', 10);
  const pluginsDir = path.resolve(rootDir, process.env.MAYDAY_PLUGINS_DIR || './plugins');
  const dataDir = path.resolve(rootDir, process.env.MAYDAY_DATA_DIR || './data');

  startServer({ port, pluginsDir, dataDir }).catch((err) => {
    console.error('Failed to start Mayday server:', err);
    process.exit(1);
  });
}
