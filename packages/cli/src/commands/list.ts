import { Command } from 'commander';
import fs from 'fs';
import path from 'path';

export const listCommand = new Command('list')
  .description('List all plugins')
  .action(async () => {
    const pluginsDir = path.resolve('plugins');
    if (!fs.existsSync(pluginsDir)) {
      console.log('No plugins directory found.');
      return;
    }

    const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(pluginsDir, entry.name, 'mayday.json');
      if (!fs.existsSync(manifestPath)) continue;

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const status = '●';
      console.log(`  ${status} ${manifest.name} (${manifest.id}) v${manifest.version}`);
      if (manifest.description) {
        console.log(`    ${manifest.description}`);
      }
      count++;
    }

    if (count === 0) {
      console.log('No plugins found. Create one with: mayday create <name>');
    } else {
      console.log(`\n${count} plugin(s) found`);
    }
  });
