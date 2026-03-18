import fs from 'fs';
import path from 'path';
import { readExcaliburCommands } from './excalibur-executor.js';

export interface StreamDeckButton {
  slot: number;        // 0-14
  label: string | null;
  macroId: string | null;  // commandName from .cmdlist.json
}

export interface StreamDeckConfig {
  version: number;
  lastUpdated: string;
  buttons: StreamDeckButton[];
}

type ChangeCallback = (config: StreamDeckConfig) => void;

const CONFIG_FILE = 'streamdeck-config.json';

function createDefaultConfig(): StreamDeckConfig {
  const buttons: StreamDeckButton[] = [];
  for (let i = 0; i < 15; i++) {
    buttons.push({ slot: i, label: null, macroId: null });
  }
  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    buttons,
  };
}

export class StreamDeckConfigService {
  private configPath: string;
  private config: StreamDeckConfig;
  private changeCallbacks = new Set<ChangeCallback>();

  constructor(dataDir: string) {
    this.configPath = path.join(dataDir, CONFIG_FILE);
    this.config = this.loadFromDisk();
  }

  getConfig(): StreamDeckConfig {
    return this.config;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  load(): StreamDeckConfig {
    this.config = this.loadFromDisk();
    return this.config;
  }

  save(config: StreamDeckConfig): void {
    config.lastUpdated = new Date().toISOString();
    this.config = config;

    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));

    for (const cb of this.changeCallbacks) {
      try { cb(config); } catch (err) {
        console.error('[StreamDeckConfig] onChange callback error:', err);
      }
    }
  }

  getAvailableCommands(): Array<{ id: string; name: string }> {
    return readExcaliburCommands();
  }

  onChange(callback: ChangeCallback): () => void {
    this.changeCallbacks.add(callback);
    return () => { this.changeCallbacks.delete(callback); };
  }

  private loadFromDisk(): StreamDeckConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        // Ensure all 15 slots exist
        if (raw.buttons && raw.buttons.length === 15) {
          return raw;
        }
      }
    } catch (err) {
      console.error('[StreamDeckConfig] Failed to load config:', err);
    }
    return createDefaultConfig();
  }
}
