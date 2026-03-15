import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { PluginDataStore } from '@mayday/types';

export class PluginRegistry {
  private db: Database.Database;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, 'plugins.db'));
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id TEXT PRIMARY KEY,
        enabled INTEGER DEFAULT 1,
        config TEXT DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS plugin_data (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (plugin_id, key)
      );
    `);
  }

  isEnabled(pluginId: string): boolean {
    const row = this.db.prepare('SELECT enabled FROM plugins WHERE id = ?').get(pluginId) as { enabled: number } | undefined;
    return row ? row.enabled === 1 : true; // Enabled by default
  }

  setEnabled(pluginId: string, enabled: boolean) {
    this.db.prepare(`
      INSERT INTO plugins (id, enabled) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET enabled = ?
    `).run(pluginId, enabled ? 1 : 0, enabled ? 1 : 0);
  }

  getConfig(pluginId: string): Record<string, unknown> {
    const row = this.db.prepare('SELECT config FROM plugins WHERE id = ?').get(pluginId) as { config: string } | undefined;
    return row ? JSON.parse(row.config) : {};
  }

  setConfig(pluginId: string, config: Record<string, unknown>) {
    this.db.prepare(`
      INSERT INTO plugins (id, config) VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET config = ?
    `).run(pluginId, JSON.stringify(config), JSON.stringify(config));
  }

  getDataStore(pluginId: string): PluginDataStore {
    const db = this.db;
    return {
      async get<T = unknown>(key: string): Promise<T | null> {
        const row = db.prepare('SELECT value FROM plugin_data WHERE plugin_id = ? AND key = ?').get(pluginId, key) as { value: string } | undefined;
        return row ? JSON.parse(row.value) as T : null;
      },
      async set(key: string, value: unknown): Promise<void> {
        db.prepare(`
          INSERT INTO plugin_data (plugin_id, key, value) VALUES (?, ?, ?)
          ON CONFLICT(plugin_id, key) DO UPDATE SET value = ?
        `).run(pluginId, key, JSON.stringify(value), JSON.stringify(value));
      },
      async delete(key: string): Promise<void> {
        db.prepare('DELETE FROM plugin_data WHERE plugin_id = ? AND key = ?').run(pluginId, key);
      },
      async list(): Promise<string[]> {
        const rows = db.prepare('SELECT key FROM plugin_data WHERE plugin_id = ?').all(pluginId) as { key: string }[];
        return rows.map(r => r.key);
      },
    };
  }
}
