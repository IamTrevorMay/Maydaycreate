import path from 'path';
import fs from 'fs';
import os from 'os';
import { pathToFileURL, fileURLToPath } from 'url';
import { build } from 'esbuild';
import type {
  PluginManifest,
  PluginDefinition,
  PluginContext,
  PluginStatus,
  PluginServices,
  PluginLogger,
  PluginDataStore,
  PluginUI,
  PluginPermission,
  BridgeMessageType,
} from '@mayday/types';
import { PERMISSION_SERVICE_MAP } from '@mayday/types';
import { EventBus } from '../events/bus.js';
import { PluginRegistry } from './registry.js';
import { TimelineService } from '../services/timeline.js';
import { AIService } from '../services/ai.js';
import { MediaService } from '../services/media.js';
import { EffectsService } from '../services/effects.js';

interface PluginEntry {
  manifest: PluginManifest;
  status: PluginStatus;
  definition?: PluginDefinition;
  context?: PluginContext;
  mainPath: string;
}

export class PluginLifecycle {
  private plugins = new Map<string, PluginEntry>();

  constructor(
    private services: { timeline: TimelineService; ai: AIService; media: MediaService; effects: EffectsService },
    private eventBus: EventBus,
    private registry: PluginRegistry,
    private dataDir: string,
  ) {}

  async loadPlugin(manifest: PluginManifest, mainPath: string, forceRebuild = false): Promise<void> {
    const entry: PluginEntry = {
      manifest,
      status: 'discovered',
      mainPath,
    };

    try {
      let importPath = mainPath;

      // Transpile .ts plugins to a .mjs file in the plugin root so node_modules resolves
      if (mainPath.endsWith('.ts')) {
        // Place build output at plugin root (not inside src/) to avoid triggering tsx watch
        const pluginRoot = path.resolve(path.dirname(mainPath), '..');
        const outFile = path.join(pluginRoot, '.mayday-build', 'index.mjs');

        // Skip rebuild if output is already up-to-date (prevents tsx watch restart loop)
        let needsBuild = forceRebuild || !fs.existsSync(outFile);
        if (!needsBuild) {
          const outMtime = fs.statSync(outFile).mtimeMs;
          const srcDir = path.dirname(mainPath);
          needsBuild = this.anySrcNewer(srcDir, outMtime);
        }

        if (needsBuild) {
          // Find node_modules that contain @mayday packages so plugins can resolve them
          const thisFile = fileURLToPath(import.meta.url);
          const nodeModulesDirs: string[] = [];
          let dir = path.dirname(thisFile);
          while (dir !== path.dirname(dir)) {
            const nm = path.join(dir, 'node_modules');
            if (fs.existsSync(path.join(nm, '@mayday', 'sdk'))) {
              // If inside an asar archive, esbuild can't read from it — use the unpacked path
              const resolvedNm = nm.includes('app.asar')
                ? nm.replace('app.asar', 'app.asar.unpacked')
                : nm;
              nodeModulesDirs.push(resolvedNm);
              break;
            }
            dir = path.dirname(dir);
          }

          // When running from an asar archive, point esbuild to its unpacked native binary
          if (nodeModulesDirs[0]?.includes('app.asar.unpacked') && !process.env.ESBUILD_BINARY_PATH) {
            const esbuildBin = path.join(
              nodeModulesDirs[0], '@esbuild',
              `${process.platform}-${process.arch}`,
              'bin', 'esbuild',
            );
            if (fs.existsSync(esbuildBin)) {
              process.env.ESBUILD_BINARY_PATH = esbuildBin;
            }
          }

          await build({
            entryPoints: [mainPath],
            bundle: true,
            format: 'esm',
            platform: 'node',
            outfile: outFile,
            // Keep native/Node modules external — they resolve from the main process
            external: ['better-sqlite3', 'brain.js', 'gpu.js', 'fs', 'path', 'os', 'crypto', 'util', 'events', 'stream', 'url', 'http', 'https', 'net', 'child_process', 'worker_threads'],
            // Allow plugins to resolve @mayday/* packages from the server's module tree
            nodePaths: nodeModulesDirs,
          });
        }
        importPath = outFile;
      }

      // Dynamic import with cache busting for hot reload
      const moduleUrl = pathToFileURL(importPath).href + '?t=' + Date.now();
      const mod = await import(moduleUrl);
      const definition = mod.default as PluginDefinition;

      if (!definition || typeof definition.activate !== 'function') {
        throw new Error('Plugin must export a default PluginDefinition with activate()');
      }

      entry.definition = definition;
      entry.status = 'loaded';
      this.plugins.set(manifest.id, entry);

      console.log(`[Lifecycle] Loaded: ${manifest.name} v${manifest.version}`);
    } catch (err) {
      entry.status = 'errored';
      this.plugins.set(manifest.id, entry);
      throw err;
    }
  }

  async activatePlugin(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
    if (entry.status === 'activated') return;
    if (!entry.definition) throw new Error(`Plugin not loaded: ${pluginId}`);

    const config = this.registry.getConfig(pluginId);
    const ctx = this.createContext(entry.manifest, config);
    entry.context = ctx;

    try {
      await entry.definition.activate(ctx);
      entry.status = 'activated';
      this.registry.setEnabled(pluginId, true);
      await this.eventBus.emit('plugin:activated', 'lifecycle', { pluginId });
      console.log(`[Lifecycle] Activated: ${entry.manifest.name}`);
    } catch (err) {
      entry.status = 'errored';
      console.error(`[Lifecycle] Activation failed for ${pluginId}:`, err);
      throw err;
    }
  }

  async deactivatePlugin(pluginId: string): Promise<void> {
    const entry = this.plugins.get(pluginId);
    if (!entry) return;
    if (entry.status !== 'activated') return;

    try {
      if (entry.definition?.deactivate && entry.context) {
        await entry.definition.deactivate(entry.context);
      }
      entry.status = 'deactivated';
      this.registry.setEnabled(pluginId, false);
      await this.eventBus.emit('plugin:deactivated', 'lifecycle', { pluginId });
      console.log(`[Lifecycle] Deactivated: ${entry.manifest.name}`);
    } catch (err) {
      entry.status = 'errored';
      console.error(`[Lifecycle] Deactivation failed for ${pluginId}:`, err);
    }
  }

  async executeCommand(pluginId: string, commandId: string, args?: Record<string, unknown>): Promise<unknown> {
    const entry = this.plugins.get(pluginId);
    if (!entry) throw new Error(`Plugin not found: ${pluginId}`);
    if (entry.status !== 'activated') throw new Error(`Plugin not activated: ${pluginId}`);
    if (!entry.definition?.commands?.[commandId]) {
      throw new Error(`Command not found: ${pluginId}/${commandId}`);
    }
    return entry.definition.commands[commandId](entry.context!, args);
  }

  getActivePlugins(): PluginManifest[] {
    return [...this.plugins.values()]
      .filter(e => e.status === 'activated')
      .map(e => e.manifest);
  }

  getAllPlugins(): Array<{ manifest: PluginManifest; status: PluginStatus }> {
    return [...this.plugins.values()].map(e => ({
      manifest: e.manifest,
      status: e.status,
    }));
  }

  /** Get persisted config for a plugin (merges defaults from manifest) */
  getPluginConfig(pluginId: string): Record<string, unknown> {
    const entry = this.plugins.get(pluginId);
    const stored = this.registry.getConfig(pluginId);
    // Merge manifest defaults under stored values
    if (entry?.manifest.config) {
      const defaults: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(entry.manifest.config)) {
        defaults[key] = schema.default;
      }
      return { ...defaults, ...stored };
    }
    return stored;
  }

  /** Update a single config key for a plugin and notify the running instance */
  setPluginConfigValue(pluginId: string, key: string, value: unknown): void {
    const current = this.registry.getConfig(pluginId);
    const updated = { ...current, [key]: value };
    this.registry.setConfig(pluginId, updated);

    // Update the live plugin context so the running plugin sees the change
    const entry = this.plugins.get(pluginId);
    if (entry?.context) {
      (entry.context.config as Record<string, unknown>)[key] = value;
    }

    this.eventBus.emit('plugin:config-changed', 'lifecycle', { pluginId, key, value });
  }

  /** Check if any .ts file under srcDir is newer than the given mtime */
  private anySrcNewer(srcDir: string, outMtime: number): boolean {
    try {
      const entries = fs.readdirSync(srcDir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(srcDir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '.mayday-build') continue;
          if (this.anySrcNewer(full, outMtime)) return true;
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          if (fs.statSync(full).mtimeMs > outMtime) return true;
        }
      }
    } catch {
      return true; // If we can't read the dir, rebuild to be safe
    }
    return false;
  }

  private createPermissionGatedServices(manifest: PluginManifest, log: PluginLogger): PluginServices {
    const allowed = new Set<string>(manifest.permissions ?? []);
    const serviceKeys = new Set(Object.values(PERMISSION_SERVICE_MAP));

    return new Proxy(this.services as unknown as PluginServices, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && serviceKeys.has(prop as keyof PluginServices)) {
          if (!allowed.has(prop)) {
            const msg = `Plugin "${manifest.id}" lacks permission for "${prop}". Add "${prop}" to permissions in mayday.json.`;
            log.error(msg);
            throw new Error(msg);
          }
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  private createContext(manifest: PluginManifest, config: Record<string, unknown>): PluginContext {
    const log: PluginLogger = {
      info: (msg, ...args) => console.log(`[${manifest.name}]`, msg, ...args),
      warn: (msg, ...args) => console.warn(`[${manifest.name}]`, msg, ...args),
      error: (msg, ...args) => console.error(`[${manifest.name}]`, msg, ...args),
      debug: (msg, ...args) => console.debug(`[${manifest.name}]`, msg, ...args),
    };

    const data: PluginDataStore = this.registry.getDataStore(manifest.id);

    const ui: PluginUI = {
      showToast: (message, type) => {
        this.eventBus.emit('ui:toast', manifest.id, { message, type: type || 'info' });
      },
      showProgress: (label, progress) => {
        this.eventBus.emit('ui:progress', manifest.id, { label, progress });
      },
      hideProgress: () => {
        this.eventBus.emit('ui:progress:hide', manifest.id, {});
      },
      pushToPanel: (type, data) => {
        const eventType = `plugin:${manifest.id}:${type}` as BridgeMessageType;
        this.eventBus.emit(eventType, manifest.id, data);
      },
    };

    const pluginDataDir = path.join(this.dataDir, manifest.id);
    if (!fs.existsSync(pluginDataDir)) {
      fs.mkdirSync(pluginDataDir, { recursive: true });
    }

    const onEvent = (eventType: string, handler: (data: unknown) => void) => {
      const sub = this.eventBus.on(eventType, (event) => {
        handler(event.data);
      });
      return sub;
    };

    return {
      pluginId: manifest.id,
      services: this.createPermissionGatedServices(manifest, log),
      config,
      log,
      data,
      ui,
      dataDir: pluginDataDir,
      onEvent,
    };
  }
}
