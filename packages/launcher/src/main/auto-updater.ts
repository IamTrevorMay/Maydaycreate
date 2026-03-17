import { spawn } from 'child_process';
import { app } from 'electron';
import type { BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import fs from 'fs';
import path from 'path';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion: string;
}

export interface UpdateProgress {
  phase: string;
  message: string;
  pct: number;
  done: boolean;
  error?: string;
}

export interface PushResult {
  commitHash: string;
  hadChanges: boolean;
  publishedVersion: string;
}

let _updating = false;
let _pushing = false;
let _win: BrowserWindow | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSpawnEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extraEnv };
  const extraPaths = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  const current = env.PATH || '';
  const missing = extraPaths.filter((p) => !current.includes(p));
  if (missing.length) {
    env.PATH = [...missing, current].join(':');
  }
  return env;
}

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: getSpawnEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

function sendProgress(win: BrowserWindow, progress: UpdateProgress): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app:updateProgress', progress);
  }
}

function runStep(
  cmd: string,
  args: string[],
  cwd: string,
  win: BrowserWindow,
  phase: string,
  extraEnv?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: getSpawnEnv(extraEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

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

function sendAutoUpdateStatus(win: BrowserWindow, state: string, message?: string): void {
  if (!win.isDestroyed()) {
    win.webContents.send('app:autoUpdateStatus', { state, message });
  }
}

// ── Consumer side (electron-updater) ─────────────────────────────────────────

export function initAutoUpdater(win: BrowserWindow): void {
  _win = win;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    if (!win.isDestroyed()) {
      win.webContents.send('app:autoUpdateStatus', {
        state: 'available',
        message: `v${info.version} available`,
      });
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    sendProgress(win, {
      phase: 'Downloading update',
      message: `${Math.round(progress.percent)}% (${formatBytes(progress.transferred)}/${formatBytes(progress.total)})`,
      pct: Math.round(progress.percent),
      done: false,
    });
  });

  autoUpdater.on('update-downloaded', () => {
    sendProgress(win, {
      phase: 'Complete',
      message: 'Update downloaded. Ready to install.',
      pct: 100,
      done: true,
    });
    sendAutoUpdateStatus(win, 'ready');
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] error:', err);
    sendProgress(win, {
      phase: 'Error',
      message: err.message,
      pct: 0,
      done: true,
      error: err.message,
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  try {
    const result = await autoUpdater.checkForUpdates();
    const currentVersion = app.getVersion();
    const latestVersion = result?.updateInfo?.version ?? currentVersion;
    const updateAvailable = latestVersion !== currentVersion;
    return { updateAvailable, currentVersion, latestVersion };
  } catch (err) {
    console.error('[AutoUpdater] checkForUpdates failed:', err);
    return {
      updateAvailable: false,
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
    };
  }
}

export async function downloadAndInstallUpdate(): Promise<void> {
  if (_updating) throw new Error('Update already in progress');
  _updating = true;
  try {
    await autoUpdater.downloadUpdate();
  } finally {
    _updating = false;
  }
}

export function quitAndInstall(): void {
  autoUpdater.quitAndInstall();
}

export async function silentAutoUpdate(win: BrowserWindow): Promise<void> {
  try {
    await new Promise((r) => setTimeout(r, 5000));

    sendAutoUpdateStatus(win, 'checking');
    const result = await checkForUpdates();

    if (!result.updateAvailable) {
      sendAutoUpdateStatus(win, 'idle');
      return;
    }

    sendAutoUpdateStatus(win, 'updating', `v${result.latestVersion} available`);
    await autoUpdater.downloadUpdate();
    sendAutoUpdateStatus(win, 'ready');
  } catch (err) {
    console.error('[AutoUpdater] silentAutoUpdate failed:', err);
    sendAutoUpdateStatus(win, 'error', err instanceof Error ? err.message : String(err));
  }
}

// ── Publisher side (push + build + publish) ──────────────────────────────────

function bumpVersion(sourceRepoPath: string): string {
  // Bump launcher package.json
  const launcherPkgPath = path.join(sourceRepoPath, 'packages', 'launcher', 'package.json');
  const launcherPkg = JSON.parse(fs.readFileSync(launcherPkgPath, 'utf-8'));
  const parts = launcherPkg.version.split('.').map(Number);
  parts[2] += 1; // bump patch
  const newVersion = parts.join('.');
  launcherPkg.version = newVersion;
  fs.writeFileSync(launcherPkgPath, JSON.stringify(launcherPkg, null, 2) + '\n', 'utf-8');

  // Bump root package.json if it exists
  const rootPkgPath = path.join(sourceRepoPath, 'package.json');
  if (fs.existsSync(rootPkgPath)) {
    const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
    if (rootPkg.version) {
      rootPkg.version = newVersion;
      fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf-8');
    }
  }

  return newVersion;
}

export async function pushVersion(
  sourceRepoPath: string,
  ghToken: string,
  win: BrowserWindow,
): Promise<PushResult> {
  if (_pushing) throw new Error('Push already in progress');
  if (_updating) throw new Error('Update in progress');
  _pushing = true;

  let hadChanges = false;
  let commitHash = '';
  let publishedVersion = '';

  const launcherDir = path.join(sourceRepoPath, 'packages', 'launcher');
  const tokenEnv = { GH_TOKEN: ghToken };

  try {
    // 1. Check for uncommitted changes
    sendProgress(win, { phase: 'Checking for changes', message: 'Running git status…', pct: 5, done: false });
    const status = await runCommand('git', ['status', '--porcelain'], sourceRepoPath);

    if (status.length > 0) {
      hadChanges = true;

      sendProgress(win, { phase: 'Staging changes', message: 'Running git add -A…', pct: 8, done: false });
      await runStep('git', ['add', '-A'], sourceRepoPath, win, 'Staging changes');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const commitMsg = `Mayday Create push — ${timestamp}`;
      sendProgress(win, { phase: 'Committing', message: commitMsg, pct: 12, done: false });
      await runStep('git', ['commit', '-m', commitMsg], sourceRepoPath, win, 'Committing');
    }

    // 2. Bump version
    sendProgress(win, { phase: 'Bumping version', message: 'Incrementing patch version…', pct: 16, done: false });
    publishedVersion = bumpVersion(sourceRepoPath);
    sendProgress(win, { phase: 'Bumping version', message: `New version: v${publishedVersion}`, pct: 18, done: false });

    // Commit version bump
    await runStep('git', ['add', '-A'], sourceRepoPath, win, 'Bumping version');
    await runStep('git', ['commit', '-m', `v${publishedVersion}`], sourceRepoPath, win, 'Bumping version');

    // 3. Push to origin
    sendProgress(win, { phase: 'Pushing to origin', message: 'Running git push origin main…', pct: 22, done: false });
    await runStep('git', ['push', 'origin', 'main'], sourceRepoPath, win, 'Pushing to origin');

    commitHash = (await runCommand('git', ['rev-parse', '--short', 'HEAD'], sourceRepoPath)).trim();

    // 4. Build workspace
    sendProgress(win, { phase: 'Building application', message: 'npm run build…', pct: 30, done: false });
    await runStep('npm', ['run', 'build'], sourceRepoPath, win, 'Building application');

    // 5. Publish via electron-builder
    sendProgress(win, { phase: 'Publishing release', message: 'Running electron-builder --publish always…', pct: 65, done: false });
    await runStep(
      'npx',
      ['electron-builder', '--publish', 'always'],
      launcherDir,
      win,
      'Publishing release',
      tokenEnv,
    );

    sendProgress(win, {
      phase: 'Complete',
      message: `Published v${publishedVersion}! Commit: ${commitHash}`,
      pct: 100,
      done: true,
    });

    return { commitHash, hadChanges, publishedVersion };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendProgress(win, { phase: 'Error', message: msg, pct: 0, done: true, error: msg });
    throw err;
  } finally {
    _pushing = false;
  }
}

export function relaunchApp(): void {
  app.relaunch();
  app.exit(0);
}
