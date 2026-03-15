import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import chokidar from 'chokidar';
import type { PluginManifest } from '@mayday/types';
import { PluginLifecycle } from './lifecycle.js';
import { EventBus } from '../events/bus.js';

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1),
  version: z.string(),
  description: z.string(),
  author: z.string().optional(),
  main: z.string().default('src/index.ts'),
  commands: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
  })).optional(),
  permissions: z.array(z.enum(['timeline', 'media', 'ai', 'effects', 'filesystem', 'network'])).optional(),
});

export class PluginLoader {
  private watcher: chokidar.FSWatcher | null = null;

  constructor(
    private pluginsDir: string,
    private lifecycle: PluginLifecycle,
    private eventBus: EventBus,
  ) {}

  async scanAndLoad(): Promise<void> {
    const absDir = path.resolve(this.pluginsDir);
    if (!fs.existsSync(absDir)) {
      console.log(`[PluginLoader] Plugins directory not found: ${absDir}`);
      return;
    }

    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = path.join(absDir, entry.name);
      const manifestPath = path.join(pluginDir, 'mayday.json');

      if (!fs.existsSync(manifestPath)) {
        console.log(`[PluginLoader] Skipping ${entry.name}: no mayday.json`);
        continue;
      }

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const manifest = ManifestSchema.parse(raw) as PluginManifest;
        const mainPath = path.join(pluginDir, manifest.main);

        await this.lifecycle.loadPlugin(manifest, mainPath);
        await this.lifecycle.activatePlugin(manifest.id);
      } catch (err) {
        console.error(`[PluginLoader] Failed to load ${entry.name}:`, err);
      }
    }
  }

  watchForChanges(): void {
    const absDir = path.resolve(this.pluginsDir);
    if (!fs.existsSync(absDir)) return;

    this.watcher = chokidar.watch(path.join(absDir, '*/src/**/*.ts'), {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });

    this.watcher.on('change', async (filePath: string) => {
      // Find which plugin changed
      const relative = path.relative(absDir, filePath);
      const pluginName = relative.split(path.sep)[0];
      const pluginDir = path.join(absDir, pluginName);
      const manifestPath = path.join(pluginDir, 'mayday.json');

      if (!fs.existsSync(manifestPath)) return;

      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const manifest = ManifestSchema.parse(raw) as PluginManifest;

        console.log(`[PluginLoader] Hot reloading: ${manifest.name}`);

        await this.lifecycle.deactivatePlugin(manifest.id);
        const mainPath = path.join(pluginDir, manifest.main);
        await this.lifecycle.loadPlugin(manifest, mainPath);
        await this.lifecycle.activatePlugin(manifest.id);

        await this.eventBus.emit('plugin:reloaded', 'loader', { pluginId: manifest.id });
      } catch (err) {
        console.error(`[PluginLoader] Hot reload failed for ${pluginName}:`, err);
      }
    });

    console.log('[PluginLoader] Watching for plugin changes...');
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }
}
