import { execFile, type ChildProcess, type ExecFileOptions } from 'child_process';

const tracked = new Set<ChildProcess>();

/**
 * Drop-in replacement for promisify(execFile) that tracks child processes
 * and supports a timeout (kills the process on expiry).
 *
 * On error the rejected object preserves `.stderr` so callers that inspect
 * it (e.g. detectSilence) continue to work.
 */
export function trackedExecFile(
  cmd: string,
  args: string[],
  opts?: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, opts ?? {}, (err, stdout, stderr) => {
      tracked.delete(child);
      if (err) {
        // Preserve stderr on the error so callers can inspect it
        (err as any).stderr = stderr;
        (err as any).stdout = stdout;
        reject(err);
      } else {
        resolve({ stdout: stdout as string, stderr: stderr as string });
      }
    });
    tracked.add(child);
  });
}

/**
 * Kill all tracked child processes. Sends SIGTERM immediately,
 * then SIGKILL after 2 seconds for any that haven't exited.
 */
export function killAllTracked(): void {
  if (tracked.size === 0) return;
  console.log(`[tracked-exec] Killing ${tracked.size} tracked process(es)`);
  const snapshot = [...tracked];
  tracked.clear();

  for (const child of snapshot) {
    try { child.kill('SIGTERM'); } catch {}
  }

  setTimeout(() => {
    for (const child of snapshot) {
      try {
        if (!child.killed) child.kill('SIGKILL');
      } catch {}
    }
  }, 2000);
}

/** Number of currently tracked child processes (diagnostic). */
export function trackedCount(): number {
  return tracked.size;
}
