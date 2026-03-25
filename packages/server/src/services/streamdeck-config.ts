import fs from 'fs';
import path from 'path';
import { readExcaliburCommands } from './excalibur-executor.js';
import { INTENT_TAGS } from '@mayday/types';

// ── Device model registry ────────────────────────────────────────────────────

export const STREAM_DECK_MODELS = {
  'mini':     { name: 'Stream Deck Mini',     rows: 2, cols: 3, total: 6  },
  'original': { name: 'Stream Deck',          rows: 3, cols: 5, total: 15 },
  'xl':       { name: 'Stream Deck XL',       rows: 4, cols: 8, total: 32 },
  'mk2':      { name: 'Stream Deck MK.2',     rows: 3, cols: 5, total: 15 },
  'pedal':    { name: 'Stream Deck Pedal',     rows: 1, cols: 3, total: 3  },
  'plus':     { name: 'Stream Deck +',         rows: 2, cols: 4, total: 8  },
} as const;

export type StreamDeckModelId = keyof typeof STREAM_DECK_MODELS;

// ── Button style fields (shared by editing + training buttons) ───────────────

export interface ButtonStyle {
  fontSize?: number;    // px, e.g. 10, 12, 14, 18
  fontColor?: string;   // hex, e.g. '#ffffff'
  bgColor?: string;     // hex, e.g. '#333333'
}

// ── Config types ─────────────────────────────────────────────────────────────

export interface StreamDeckButton extends ButtonStyle {
  slot: number;
  label: string | null;
  macroId: string | null;  // commandName from .cmdlist.json
}

export interface StreamDeckTrainingButton extends ButtonStyle {
  slot: number;
  label: string | null;
  actionType: 'tag' | 'submit' | 'clear' | null;
  actionId: string | null;  // tag ID for 'tag' type
}

export interface StreamDeckConfig {
  version: 2;
  deviceModel: StreamDeckModelId;
  lastUpdated: string;
  buttons: StreamDeckButton[];
  trainingButtons?: StreamDeckTrainingButton[];
}

/** Legacy v1 config shape (no deviceModel, always 15 buttons) */
interface StreamDeckConfigV1 {
  version: 1 | number;
  lastUpdated: string;
  buttons: StreamDeckButton[];
}

type ChangeCallback = (config: StreamDeckConfig) => void;

const CONFIG_FILE = 'streamdeck-config.json';

function createDefaultButtons(count: number): StreamDeckButton[] {
  const buttons: StreamDeckButton[] = [];
  for (let i = 0; i < count; i++) {
    buttons.push({ slot: i, label: null, macroId: null });
  }
  return buttons;
}

export function createDefaultTrainingButtons(count: number): StreamDeckTrainingButton[] {
  const buttons: StreamDeckTrainingButton[] = [];
  for (let i = 0; i < count; i++) {
    if (i < INTENT_TAGS.length) {
      buttons.push({
        slot: i,
        label: INTENT_TAGS[i].label,
        actionType: 'tag',
        actionId: INTENT_TAGS[i].id,
        bgColor: '#2a2a3e',
        fontColor: '#8c8c8c',
      });
    } else if (i === INTENT_TAGS.length) {
      buttons.push({
        slot: i,
        label: 'Submit',
        actionType: 'submit',
        actionId: null,
        bgColor: '#22573c',
        fontColor: '#ffffff',
      });
    } else if (i === INTENT_TAGS.length + 1) {
      buttons.push({
        slot: i,
        label: 'Clear',
        actionType: 'clear',
        actionId: null,
        bgColor: '#7f1d1d',
        fontColor: '#ffffff',
      });
    } else {
      buttons.push({ slot: i, label: null, actionType: null, actionId: null });
    }
  }
  return buttons;
}

export function createDefaultConfig(model: StreamDeckModelId = 'original'): StreamDeckConfig {
  const info = STREAM_DECK_MODELS[model];
  return {
    version: 2,
    deviceModel: model,
    lastUpdated: new Date().toISOString(),
    buttons: createDefaultButtons(info.total),
    trainingButtons: createDefaultTrainingButtons(info.total),
  };
}

/** Migrate v1 config (15 hardcoded buttons, no model) → v2 */
export function migrateV1ToV2(raw: StreamDeckConfigV1): StreamDeckConfig {
  const model: StreamDeckModelId = 'original';
  const info = STREAM_DECK_MODELS[model];

  const buttons: StreamDeckButton[] = [];
  for (let i = 0; i < info.total; i++) {
    const existing = raw.buttons?.find(b => b.slot === i);
    buttons.push(existing ?? { slot: i, label: null, macroId: null });
  }

  return {
    version: 2,
    deviceModel: model,
    lastUpdated: raw.lastUpdated || new Date().toISOString(),
    buttons,
    trainingButtons: createDefaultTrainingButtons(info.total),
  };
}

/** Resize button array when switching device models */
export function resizeButtonsForModel(
  config: StreamDeckConfig,
  newModel: StreamDeckModelId,
): StreamDeckConfig {
  const info = STREAM_DECK_MODELS[newModel];
  const buttons: StreamDeckButton[] = [];
  for (let i = 0; i < info.total; i++) {
    const existing = config.buttons.find(b => b.slot === i);
    buttons.push(existing ?? { slot: i, label: null, macroId: null });
  }
  const trainingButtons: StreamDeckTrainingButton[] = [];
  const defaultTraining = createDefaultTrainingButtons(info.total);
  for (let i = 0; i < info.total; i++) {
    const existing = config.trainingButtons?.find(b => b.slot === i);
    trainingButtons.push(existing ?? defaultTraining[i]);
  }
  return {
    ...config,
    deviceModel: newModel,
    buttons,
    trainingButtons,
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

        // Already v2 — validate button count matches model
        if (raw.version === 2 && raw.deviceModel && STREAM_DECK_MODELS[raw.deviceModel as StreamDeckModelId]) {
          const info = STREAM_DECK_MODELS[raw.deviceModel as StreamDeckModelId];

          // Ensure trainingButtons exist
          if (!raw.trainingButtons || !Array.isArray(raw.trainingButtons)) {
            raw.trainingButtons = createDefaultTrainingButtons(info.total);
          }

          if (raw.buttons?.length === info.total) {
            // Resize training buttons if needed
            if (raw.trainingButtons.length !== info.total) {
              const defaultTraining = createDefaultTrainingButtons(info.total);
              const tb: StreamDeckTrainingButton[] = [];
              for (let i = 0; i < info.total; i++) {
                const existing = raw.trainingButtons.find((b: any) => b.slot === i);
                tb.push(existing ?? defaultTraining[i]);
              }
              raw.trainingButtons = tb;
            }
            return raw as StreamDeckConfig;
          }
          // Button count mismatch — resize
          return resizeButtonsForModel(raw as StreamDeckConfig, raw.deviceModel);
        }

        // v1 or unknown — migrate
        if (raw.buttons && Array.isArray(raw.buttons)) {
          const migrated = migrateV1ToV2(raw as StreamDeckConfigV1);
          fs.writeFileSync(this.configPath, JSON.stringify(migrated, null, 2));
          console.log('[StreamDeckConfig] Migrated v1 config to v2');
          return migrated;
        }
      }
    } catch (err) {
      console.error('[StreamDeckConfig] Failed to load config:', err);
    }
    return createDefaultConfig();
  }
}
