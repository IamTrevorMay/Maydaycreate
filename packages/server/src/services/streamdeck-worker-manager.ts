import { ChildProcess, spawn } from 'child_process';
import { createInterface, Interface } from 'readline';
import path from 'path';
import fs from 'fs';

export interface WorkerDevice {
  path: string;
  model: string;
  serialNumber: string | null;
}

export interface WorkerOpenResult {
  success: boolean;
  serialNumber?: string | null;
  firmwareVersion?: string | null;
  model?: string;
  error?: string;
}

type MessageHandler = (msg: any) => void;

export class StreamDeckWorkerManager {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private ready = false;
  private pendingResponses = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private eventHandlers = new Map<string, Set<MessageHandler>>();
  private nextId = 1;
  private workerPath: string;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(workerPath?: string) {
    this.workerPath = workerPath ?? this.resolveWorkerPath();
  }

  private resolveWorkerPath(): string {
    // Packaged app: resources/streamdeck-worker/worker.js
    if (typeof process !== 'undefined' && (process as any).resourcesPath) {
      const packaged = path.join((process as any).resourcesPath, 'streamdeck-worker', 'worker.js');
      if (fs.existsSync(packaged)) return packaged;
    }

    // Dev mode: walk up from CWD to find tools/streamdeck-worker/worker.js
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, 'tools', 'streamdeck-worker', 'worker.js');
      if (fs.existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }

    // Fallback: relative to this file (compiled server in monorepo)
    return path.resolve(__dirname, '../../../../tools/streamdeck-worker/worker.js');
  }

  async start(): Promise<boolean> {
    if (this.proc) return this.ready;
    this.stopped = false;

    // Find system Node.js
    const nodeBin = this.findSystemNode();
    if (!nodeBin) {
      console.error('[WorkerManager] Cannot find system Node.js in PATH');
      return false;
    }

    if (!fs.existsSync(this.workerPath)) {
      console.error(`[WorkerManager] Worker script not found: ${this.workerPath}`);
      return false;
    }

    // Check if worker deps are installed
    const workerDir = path.dirname(this.workerPath);
    const nodeModules = path.join(workerDir, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
      console.warn(`[WorkerManager] Worker node_modules not found at ${nodeModules}. Run: cd ${workerDir} && npm install`);
      return false;
    }

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        console.error('[WorkerManager] Worker startup timed out');
        resolve(false);
      }, 10000);

      this.proc = spawn(nodeBin, [this.workerPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: path.dirname(this.workerPath),
        env: { ...process.env },
      });

      this.rl = createInterface({ input: this.proc.stdout! });

      this.rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          this.handleMessage(msg);

          // Resolve start promise on 'ready'
          if (msg.type === 'ready' && !this.ready) {
            this.ready = true;
            clearTimeout(timeout);
            console.log('[WorkerManager] Worker ready');
            resolve(true);
          }
        } catch (err) {
          console.error('[WorkerManager] Failed to parse worker message:', line);
        }
      });

      this.proc.stderr?.on('data', (data) => {
        console.error('[WorkerManager] stderr:', data.toString().trim());
      });

      this.proc.on('exit', (code) => {
        console.log(`[WorkerManager] Worker exited with code ${code}`);
        this.cleanup();

        // Respawn if not intentionally stopped
        if (!this.stopped) {
          this.respawnTimer = setTimeout(() => {
            console.log('[WorkerManager] Respawning worker...');
            this.start().catch(() => {});
          }, 3000);
        }
      });

      this.proc.on('error', (err) => {
        console.error('[WorkerManager] Worker spawn error:', err.message);
        clearTimeout(timeout);
        this.cleanup();
        resolve(false);
      });
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    if (this.proc) {
      // Close stdin to signal worker to exit gracefully
      try { this.proc.stdin?.end(); } catch {}
      // Force kill after 2s if still alive
      const killTimer = setTimeout(() => {
        try { this.proc?.kill('SIGKILL'); } catch {}
      }, 2000);
      this.proc.once('exit', () => clearTimeout(killTimer));
    }
    this.cleanup();
  }

  isReady(): boolean {
    return this.ready && this.proc !== null;
  }

  // ── Public API (request/response wrappers) ──────────────────────────────

  async listDevices(): Promise<WorkerDevice[]> {
    const res = await this.sendRequest('list-devices', {});
    if (!res.success) throw new Error(res.error || 'list-devices failed');
    return res.devices ?? [];
  }

  async openDevice(devicePath: string): Promise<WorkerOpenResult> {
    return this.sendRequest('open-device', { path: devicePath });
  }

  async closeDevice(): Promise<void> {
    await this.sendRequest('close-device', {});
  }

  async fillColor(slot: number, r: number, g: number, b: number): Promise<void> {
    await this.sendRequest('fill-color', { slot, r, g, b });
  }

  async fillImage(slot: number, bufferBase64: string): Promise<void> {
    await this.sendRequest('fill-image', { slot, buffer: bufferBase64 });
  }

  async setBrightness(brightness: number): Promise<void> {
    await this.sendRequest('set-brightness', { brightness });
  }

  async fillText(slot: number, label: string): Promise<void> {
    await this.sendRequest('fill-text', { slot, label });
  }

  // ── Event subscription ──────────────────────────────────────────────────

  on(event: string, handler: MessageHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => { this.eventHandlers.get(event)?.delete(handler); };
  }

  // ── Internals ───────────────────────────────────────────────────────────

  private sendRequest(type: string, data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error('Worker not running'));
        return;
      }

      const id = String(this.nextId++);
      const timeout = setTimeout(() => {
        this.pendingResponses.delete(id);
        reject(new Error(`Worker request '${type}' timed out`));
      }, 10000);

      this.pendingResponses.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v); },
        reject: (e) => { clearTimeout(timeout); reject(e); },
      });

      const msg = JSON.stringify({ id, type, ...data }) + '\n';
      this.proc.stdin.write(msg);
    });
  }

  private handleMessage(msg: any): void {
    // Response to a pending request
    if (msg.type === 'response' && msg.id && this.pendingResponses.has(msg.id)) {
      const pending = this.pendingResponses.get(msg.id)!;
      this.pendingResponses.delete(msg.id);
      pending.resolve(msg);
      return;
    }

    // Device events (device:down, device:up, device:error)
    if (msg.type?.startsWith('device:')) {
      const handlers = this.eventHandlers.get(msg.type);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg); } catch (err) {
            console.error(`[WorkerManager] Event handler error for ${msg.type}:`, err);
          }
        }
      }
      return;
    }

    // Error events from worker
    if (msg.type === 'error') {
      console.error('[WorkerManager] Worker error:', msg.error);
    }
  }

  private cleanup(): void {
    this.ready = false;
    this.rl?.close();
    this.rl = null;
    this.proc = null;

    // Reject all pending requests
    for (const [id, pending] of this.pendingResponses) {
      pending.reject(new Error('Worker process exited'));
    }
    this.pendingResponses.clear();
  }

  private findSystemNode(): string | null {
    // Common system Node.js locations
    const candidates = [
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
    ];

    // Also check PATH
    const pathDirs = (process.env.PATH || '').split(':');
    for (const dir of pathDirs) {
      const candidate = path.join(dir, 'node');
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }

    return null;
  }
}
