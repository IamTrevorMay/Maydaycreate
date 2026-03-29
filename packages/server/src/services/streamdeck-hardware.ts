import type { StreamDeckConfigService, StreamDeckConfig, StreamDeckTrainingButton } from './streamdeck-config.js';
import type { BridgeHandler } from '../bridge/handler.js';
import type { StreamDeckWorkerManager } from './streamdeck-worker-manager.js';
import { simulateKeystroke } from './keystroke-simulator.js';
import type { ExcaliburHotkeyManager } from './excalibur-hotkeys.js';

export interface StreamDeckStatus {
  connected: boolean;
  deviceType: string | null;
  serialNumber: string | null;
  error: string | null;
}

export interface TrainingAction {
  type: 'toggle-tag' | 'submit' | 'clear';
  payload: any;
}

/** Parse hex color '#rrggbb' to { r, g, b } */
function hexToRgb(hex: string | undefined): { r: number; g: number; b: number } | undefined {
  if (!hex) return undefined;
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return undefined;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

export class StreamDeckHardwareService {
  private configService: StreamDeckConfigService;
  private bridge: BridgeHandler;
  private workerManager: StreamDeckWorkerManager;
  private unsubscribeConfig: (() => void) | null = null;
  private unsubscribeDown: (() => void) | null = null;
  private unsubscribeError: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private deviceOpen = false;
  private manuallyDisconnected = false;
  private status: StreamDeckStatus = {
    connected: false,
    deviceType: null,
    serialNumber: null,
    error: null,
  };

  // Training mode state
  private mode: 'editing' | 'training' = 'editing';
  private trainingTags: string[] = [];
  private trainingRecordId: number | null = null;
  private onTrainingAction: ((action: TrainingAction) => void) | null = null;
  private hotkeyManager: ExcaliburHotkeyManager | null = null;

  constructor(configService: StreamDeckConfigService, bridge: BridgeHandler, workerManager: StreamDeckWorkerManager) {
    this.configService = configService;
    this.bridge = bridge;
    this.workerManager = workerManager;
  }

  setHotkeyManager(manager: ExcaliburHotkeyManager): void {
    this.hotkeyManager = manager;
  }

  async start(): Promise<void> {
    const workerReady = await this.workerManager.start();
    if (!workerReady) {
      this.status.error = 'Stream Deck worker failed to start';
      console.warn('[StreamDeckHW] Worker not available — hardware control disabled');
      return;
    }

    // Subscribe to config changes — re-render in both modes
    this.unsubscribeConfig = this.configService.onChange((config) => {
      if (!this.deviceOpen) return;
      if (this.mode === 'training') {
        this.renderTrainingButtons(config).catch(err => {
          console.error('[StreamDeckHW] Training render error on config change:', err);
        });
      } else {
        this.renderButtons(config).catch(err => {
          console.error('[StreamDeckHW] Render error on config change:', err);
        });
      }
    });

    this.unsubscribeDown = this.workerManager.on('device:down', (msg) => {
      this.onButtonPress(msg.slot);
    });

    this.unsubscribeError = this.workerManager.on('device:error', (msg) => {
      console.error('[StreamDeckHW] Device error:', msg.error);
      this.handleDisconnect();
    });

    await this.tryConnect();

    this.reconnectTimer = setInterval(() => {
      if (!this.deviceOpen && !this.manuallyDisconnected && this.workerManager.isReady()) {
        this.tryConnect().catch(() => {});
      }
    }, 5000);
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.unsubscribeConfig) {
      this.unsubscribeConfig();
      this.unsubscribeConfig = null;
    }
    if (this.unsubscribeDown) {
      this.unsubscribeDown();
      this.unsubscribeDown = null;
    }
    if (this.unsubscribeError) {
      this.unsubscribeError();
      this.unsubscribeError = null;
    }
    if (this.deviceOpen) {
      this.workerManager.closeDevice().catch(() => {});
      this.deviceOpen = false;
    }
    this.workerManager.stop();
    this.status.connected = false;
    this.status.deviceType = null;
    this.status.serialNumber = null;
  }

  getStatus(): StreamDeckStatus {
    return { ...this.status };
  }

  async disconnect(): Promise<StreamDeckStatus> {
    this.manuallyDisconnected = true;
    if (this.deviceOpen) {
      try {
        await this.workerManager.closeDevice();
      } catch {}
      this.handleDisconnect();
    }
    return this.getStatus();
  }

  async reconnect(): Promise<void> {
    this.manuallyDisconnected = false;
    await this.tryConnect();
  }

  // ── Training mode API ────────────────────────────────────────────────────

  setTrainingActionHandler(handler: (action: TrainingAction) => void): void {
    this.onTrainingAction = handler;
  }

  setMode(mode: 'editing' | 'training'): void {
    this.mode = mode;
    if (!this.deviceOpen) return;
    const config = this.configService.getConfig();
    if (mode === 'training') {
      this.renderTrainingButtons(config).catch(err => {
        console.error('[StreamDeckHW] Training render error:', err);
      });
    } else {
      this.renderButtons(config).catch(err => {
        console.error('[StreamDeckHW] Editing render error:', err);
      });
    }
  }

  getMode(): 'editing' | 'training' {
    return this.mode;
  }

  updateTrainingTags(tags: string[]): void {
    this.trainingTags = tags;
    if (this.deviceOpen && this.mode === 'training') {
      this.renderTrainingButtons(this.configService.getConfig()).catch(err => {
        console.error('[StreamDeckHW] Training render error:', err);
      });
    }
  }

  getTrainingTags(): string[] {
    return [...this.trainingTags];
  }

  onNewFeedbackRequest(recordId: number): void {
    this.trainingRecordId = recordId;
    if (this.deviceOpen && this.mode === 'training') {
      this.renderTrainingButtons(this.configService.getConfig()).catch(err => {
        console.error('[StreamDeckHW] Training render error:', err);
      });
    }
  }

  getTrainingRecordId(): number | null {
    return this.trainingRecordId;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async tryConnect(): Promise<void> {
    if (!this.workerManager.isReady()) return;

    try {
      const devices = await this.workerManager.listDevices();
      if (devices.length === 0) return;

      const deviceInfo = devices[0];
      const result = await this.workerManager.openDevice(deviceInfo.path);

      if (!result.success) {
        this.status.error = result.error ?? 'Failed to open device';
        return;
      }

      this.deviceOpen = true;
      this.status.connected = true;
      this.status.deviceType = result.model ?? deviceInfo.model ?? 'StreamDeck';
      this.status.serialNumber = result.serialNumber ?? deviceInfo.serialNumber ?? null;
      this.status.error = null;

      console.log(`[StreamDeckHW] Connected: ${this.status.deviceType} (${this.status.serialNumber})`);

      const config = this.configService.getConfig();
      if (this.mode === 'training') {
        await this.renderTrainingButtons(config);
      } else {
        await this.renderButtons(config);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('No Stream Deck')) {
        this.status.error = msg;
        console.warn('[StreamDeckHW] Connection attempt failed:', msg);
      }
    }
  }

  private handleDisconnect(): void {
    this.deviceOpen = false;
    this.status.connected = false;
    this.status.deviceType = null;
    this.status.serialNumber = null;
    console.log('[StreamDeckHW] Disconnected');
  }

  private async renderButtons(config: StreamDeckConfig): Promise<void> {
    if (!this.deviceOpen) return;

    for (const button of config.buttons) {
      try {
        if (button.label) {
          const bg = hexToRgb(button.bgColor);
          const fg = hexToRgb(button.fontColor);
          await this.workerManager.fillText(button.slot, button.label, {
            ...(bg ? { bgR: bg.r, bgG: bg.g, bgB: bg.b } : {}),
            ...(fg ? { fgR: fg.r, fgG: fg.g, fgB: fg.b } : {}),
          });
        } else {
          await this.workerManager.fillColor(button.slot, 0, 0, 0);
        }
      } catch (err) {
        console.error(`[StreamDeckHW] Failed to render button ${button.slot}:`, err);
      }
    }
  }

  private async renderTrainingButtons(config: StreamDeckConfig): Promise<void> {
    if (!this.deviceOpen) return;

    const trainingButtons = config.trainingButtons ?? [];

    for (const button of trainingButtons) {
      try {
        if (!button.label || !button.actionType) {
          await this.workerManager.fillColor(button.slot, 0, 0, 0);
          continue;
        }

        // Determine colors based on active state for tag buttons
        let bgHex = button.bgColor;
        let fgHex = button.fontColor;

        if (button.actionType === 'tag' && button.actionId) {
          const active = this.trainingTags.includes(button.actionId);
          if (active) {
            bgHex = '#22573c';
            fgHex = '#ffffff';
          } else {
            bgHex = button.bgColor || '#2a2a3e';
            fgHex = button.fontColor || '#8c8c8c';
          }
        }

        const bg = hexToRgb(bgHex);
        const fg = hexToRgb(fgHex);
        await this.workerManager.fillText(button.slot, button.label, {
          ...(bg ? { bgR: bg.r, bgG: bg.g, bgB: bg.b } : {}),
          ...(fg ? { fgR: fg.r, fgG: fg.g, fgB: fg.b } : {}),
        });
      } catch (err) {
        console.error(`[StreamDeckHW] Failed to render training button ${button.slot}:`, err);
      }
    }
  }

  private onButtonPress(slot: number): void {
    if (this.mode === 'training') {
      this.onTrainingButtonPress(slot);
      return;
    }

    const config = this.configService.getConfig();
    const button = config.buttons.find(b => b.slot === slot);

    if (!button?.macroId) {
      console.log(`[StreamDeckHW] Button ${slot} pressed — no macro assigned`);
      return;
    }

    console.log(`[StreamDeckHW] Button ${slot} pressed — executing "${button.macroId}"`);

    if (!this.hotkeyManager) {
      console.error(`[StreamDeckHW] No hotkey manager — cannot execute "${button.macroId}"`);
      return;
    }

    // Get or assign a hotkey for this command
    let assignment = this.hotkeyManager.getAssignment(button.macroId);
    if (!assignment) {
      try {
        assignment = this.hotkeyManager.assignHotkey(button.macroId);
        this.hotkeyManager.syncToSpellBook();
        console.log(`[StreamDeckHW] Auto-assigned hotkey ${assignment.key} (Ctrl+Opt) to "${button.macroId}"`);
      } catch (err) {
        console.error(`[StreamDeckHW] Failed to assign hotkey for "${button.macroId}":`, err);
        return;
      }
    }

    simulateKeystroke(assignment)
      .then(() => {
        console.log(`[StreamDeckHW] Sent hotkey ${assignment!.key} for "${button.macroId}"`);
      })
      .catch(err => {
        console.error(`[StreamDeckHW] Keystroke simulation failed for "${button.macroId}":`, err);
      });
  }

  private onTrainingButtonPress(slot: number): void {
    if (!this.onTrainingAction) return;

    const config = this.configService.getConfig();
    const button = config.trainingButtons?.find(b => b.slot === slot);
    if (!button || !button.actionType) return;

    if (button.actionType === 'tag' && button.actionId) {
      const tagId = button.actionId;
      if (this.trainingTags.includes(tagId)) {
        this.trainingTags = this.trainingTags.filter(t => t !== tagId);
      } else {
        this.trainingTags.push(tagId);
      }
      this.onTrainingAction({ type: 'toggle-tag', payload: { tagId, tags: [...this.trainingTags] } });
      this.renderTrainingButtons(config).catch(() => {});
      return;
    }

    if (button.actionType === 'submit') {
      this.onTrainingAction({ type: 'submit', payload: { tags: [...this.trainingTags], recordId: this.trainingRecordId } });
      this.trainingTags = [];
      this.renderTrainingButtons(config).catch(() => {});
      return;
    }

    if (button.actionType === 'clear') {
      this.onTrainingAction({ type: 'clear', payload: {} });
      this.trainingTags = [];
      this.renderTrainingButtons(config).catch(() => {});
      return;
    }
  }
}
