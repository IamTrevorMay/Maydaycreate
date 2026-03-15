import { Command } from 'commander';
import { execSync } from 'child_process';
import path from 'path';

export const buildCommand = new Command('build')
  .description('Build all packages')
  .action(async () => {
    const root = path.resolve('.');
    console.log('Building Mayday Create...');

    const steps = [
      { name: 'types', cmd: 'npm run build:types' },
      { name: 'sdk', cmd: 'npm run build:sdk' },
      { name: 'server', cmd: 'npm run build:server' },
      { name: 'cli', cmd: 'npm run build:cli' },
      { name: 'extendscript', cmd: 'npm run -w packages/extendscript build' },
      { name: 'cep-panel', cmd: 'npm run build:cep' },
    ];

    for (const step of steps) {
      console.log(`  Building ${step.name}...`);
      try {
        execSync(step.cmd, { cwd: root, stdio: 'pipe' });
        console.log(`  ✓ ${step.name}`);
      } catch (err) {
        console.error(`  ✗ ${step.name} failed`);
        throw err;
      }
    }

    console.log('Build complete!');
  });
