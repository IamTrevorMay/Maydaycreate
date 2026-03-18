import { createClient, SupabaseClient } from '@supabase/supabase-js';
import fs from 'fs';

export interface StreamDeckSyncConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  machineId: string;
  machineName: string;
  configFilePath: string;
}

export class StreamDeckSyncService {
  private client: SupabaseClient | null = null;
  private config: StreamDeckSyncConfig | null = null;
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private pushDebounce: ReturnType<typeof setTimeout> | null = null;
  private hasReconciled = false;

  initialize(config: StreamDeckSyncConfig): void {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.log('[StreamDeckSync] No Supabase credentials configured, sync disabled');
      return;
    }
    this.config = config;
    this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[StreamDeckSync] Initialized for machine:', config.machineId);
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async pushConfig(): Promise<void> {
    if (!this.client || !this.config) return;

    try {
      if (!fs.existsSync(this.config.configFilePath)) return;

      const localConfig = JSON.parse(fs.readFileSync(this.config.configFilePath, 'utf-8'));

      const { error } = await this.client
        .from('streamdeck_configs')
        .upsert({
          id: this.config.machineId,
          machine_name: this.config.machineName,
          config: localConfig,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });

      if (error) {
        console.error('[StreamDeckSync] Push error:', error.message);
      } else {
        console.log('[StreamDeckSync] Pushed config');
      }
    } catch (err) {
      console.error('[StreamDeckSync] Push error:', err);
    }
  }

  async pullConfig(): Promise<void> {
    if (!this.client || !this.config) return;

    try {
      const { data, error } = await this.client
        .from('streamdeck_configs')
        .select('*')
        .eq('id', this.config.machineId)
        .single();

      if (error) {
        if (error.code !== 'PGRST116') { // Not "no rows" error
          console.error('[StreamDeckSync] Pull error:', error.message);
        }
        return;
      }

      if (!data?.config) return;

      // Migrate v1 → v2 if remote config is missing deviceModel
      let remoteConfig = data.config;
      if (!remoteConfig.deviceModel || remoteConfig.version !== 2) {
        remoteConfig = {
          version: 2,
          deviceModel: 'original',
          lastUpdated: remoteConfig.lastUpdated || new Date().toISOString(),
          buttons: remoteConfig.buttons || [],
        };
        // Ensure all 15 slots exist for 'original' model
        if (remoteConfig.buttons.length < 15) {
          for (let i = remoteConfig.buttons.length; i < 15; i++) {
            remoteConfig.buttons.push({ slot: i, label: null, macroId: null });
          }
        }
        console.log('[StreamDeckSync] Migrated pulled config from v1 to v2');
      }

      // Only overwrite if remote is newer
      if (fs.existsSync(this.config.configFilePath)) {
        const localConfig = JSON.parse(fs.readFileSync(this.config.configFilePath, 'utf-8'));
        const localUpdated = new Date(localConfig.lastUpdated || 0).getTime();
        const remoteUpdated = new Date(remoteConfig.lastUpdated || 0).getTime();

        if (remoteUpdated <= localUpdated) return;
      }

      fs.writeFileSync(this.config.configFilePath, JSON.stringify(remoteConfig, null, 2));
      console.log('[StreamDeckSync] Pulled config');
    } catch (err) {
      console.error('[StreamDeckSync] Pull error:', err);
    }
  }

  startPeriodicSync(): void {
    if (this.syncTimer) return;
    if (!this.client || !this.config) return;

    // Watch config file for local changes
    this.watchConfigFile();

    // Initial full reconciliation after 12s
    setTimeout(async () => {
      if (!this.hasReconciled) {
        this.hasReconciled = true;
        await this.pullConfig();
        await this.pushConfig();
        console.log('[StreamDeckSync] Initial reconciliation complete');
      }
    }, 12000);

    // Periodic sync every 30s
    this.syncTimer = setInterval(async () => {
      try {
        await this.pushConfig();
        await this.pullConfig();
      } catch (err) {
        console.error('[StreamDeckSync] Periodic sync error:', err);
      }
    }, 30000);

    console.log('[StreamDeckSync] Periodic sync started (30s interval)');
  }

  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.pushDebounce) {
      clearTimeout(this.pushDebounce);
      this.pushDebounce = null;
    }
  }

  private watchConfigFile(): void {
    if (!this.config) return;

    try {
      this.fileWatcher = fs.watch(this.config.configFilePath, () => {
        // Debounce: wait 1s after last change
        if (this.pushDebounce) clearTimeout(this.pushDebounce);
        this.pushDebounce = setTimeout(() => {
          this.pushConfig().catch(() => {});
        }, 1000);
      });
    } catch {
      // File may not exist yet — that's fine, periodic sync will handle it
    }
  }
}
