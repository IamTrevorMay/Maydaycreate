import { Command } from 'commander';
import { spawn } from 'child_process';
import path from 'path';

export const devCommand = new Command('dev')
  .description('Start the Mayday development server')
  .option('-p, --port <port>', 'Server port', '9876')
  .action(async (opts: { port: string }) => {
    console.log(`Starting Mayday dev server on port ${opts.port}...`);

    const serverDir = path.resolve('packages/server');
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MAYDAY_PORT: opts.port },
      stdio: 'inherit',
    });

    child.on('error', (err) => {
      console.error('Failed to start server:', err.message);
      process.exit(1);
    });

    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });

    process.on('SIGINT', () => {
      child.kill('SIGINT');
    });
  });
