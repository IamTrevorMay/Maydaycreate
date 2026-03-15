import { spawn } from 'child_process';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentCommit: string;
  latestCommit: string;
  commitsBehind: number;
}

export interface UpdateProgress {
  phase: string;
  message: string;
  pct: number;
  done: boolean;
  error?: string;
}

let _updating = false;

function getSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = env.PATH || '';
  const missing = extraPaths.filter((p) => !current.includes(p));
  if (missing.length) {
    env.PATH = [...missing, current].join(':');
  }
  return env;
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: getSpawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}: ${stderr.trim()}`));
    });
    proc.on('error', reject);
  });
}

export async function checkForUpdates(sourceRepoPath: string): Promise<UpdateCheckResult> {
  try {
    await runCommand('git', ['fetch', 'origin', 'main'], sourceRepoPath);
    const currentCommit = await runCommand('git', ['rev-parse', 'HEAD'], sourceRepoPath);
    const latestCommit = await runCommand('git', ['rev-parse', 'origin/main'], sourceRepoPath);
    const behindStr = await runCommand('git', ['rev-list', 'HEAD..origin/main', '--count'], sourceRepoPath);
    const commitsBehind = parseInt(behindStr, 10) || 0;

    return {
      updateAvailable: commitsBehind > 0,
      currentCommit: currentCommit.slice(0, 8),
      latestCommit: latestCommit.slice(0, 8),
      commitsBehind,
    };
  } catch (err) {
    console.error('[AutoUpdater] checkForUpdates failed:', err);
    return { updateAvailable: false, currentCommit: 'error', latestCommit: 'error', commitsBehind: 0 };
  }
}

function sendProgress(win: BrowserWindow, progress: UpdateProgress): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app:updateProgress', progress);
  }
}

interface BuildStep {
  phase: string;
  cmd: string;
  args: string[];
  pct: number;
}

export async function installUpdate(sourceRepoPath: string, win: BrowserWindow): Promise<void> {
  if (_updating) throw new Error('Update already in progress');
  _updating = true;

  const steps: BuildStep[] = [
    { phase: 'Pulling latest changes', cmd: 'git', args: ['pull', 'origin', 'main'], pct: 10 },
    { phase: 'Installing dependencies', cmd: 'npm', args: ['install'], pct: 30 },
    { phase: 'Building application', cmd: 'npm', args: ['run', 'build'], pct: 55 },
    { phase: 'Packaging app bundle', cmd: 'npm', args: ['run', 'package:launcher'], pct: 80 },
  ];

  try {
    for (const step of steps) {
      sendProgress(win, { phase: step.phase, message: `Running: ${step.cmd} ${step.args.join(' ')}`, pct: step.pct, done: false });
      await runStep(step.cmd, step.args, sourceRepoPath, win, step.phase);
    }

    // Copy the built .app to /Applications
    sendProgress(win, { phase: 'Installing to Applications', message: 'Copying app bundle…', pct: 90, done: false });
    const appSource = `${sourceRepoPath}/packages/launcher/release/mac-arm64/Mayday Create.app`;
    const appDest = '/Applications/Mayday Create.app';
    await runCommand('rm', ['-rf', appDest], sourceRepoPath);
    await runCommand('cp', ['-R', appSource, appDest], sourceRepoPath);

    sendProgress(win, { phase: 'Complete', message: 'Update installed successfully!', pct: 100, done: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(win, { phase: 'Error', message: msg, pct: 0, done: true, error: msg });
    throw err;
  } finally {
    _updating = false;
  }
}

function runStep(cmd: string, args: string[], cwd: string, win: BrowserWindow, phase: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, env: getSpawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });

    proc.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        sendProgress(win, { phase, message: line, pct: -1, done: false });
      }
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        sendProgress(win, { phase, message: line, pct: -1, done: false });
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(' ')}" failed with exit code ${code}`));
    });

    proc.on('error', reject);
  });
}

export function relaunchApp(): void {
  app.relaunch();
  app.exit(0);
}
