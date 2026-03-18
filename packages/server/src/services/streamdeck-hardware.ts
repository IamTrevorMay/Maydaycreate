import type { StreamDeckConfigService, StreamDeckConfig } from './streamdeck-config.js';
import type { BridgeHandler } from '../bridge/handler.js';
import type { StreamDeckWorkerManager } from './streamdeck-worker-manager.js';
import { executeExcaliburCommand } from './excalibur-executor.js';

export interface StreamDeckStatus {
  connected: boolean;
  deviceType: string | null;
  serialNumber: string | null;
  error: string | null;
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
  private status: StreamDeckStatus = {
    connected: false,
    deviceType: null,
    serialNumber: null,
    error: null,
  };

  constructor(configService: StreamDeckConfigService, bridge: BridgeHandler, workerManager: StreamDeckWorkerManager) {
    this.configService = configService;
    this.bridge = bridge;
    this.workerManager = workerManager;
  }

  async start(): Promise<void> {
    // Start the worker child process
    const workerReady = await this.workerManager.start();
    if (!workerReady) {
      this.status.error = 'Stream Deck worker failed to start';
      console.warn('[StreamDeckHW] Worker not available — hardware control disabled');
      return;
    }

    // Subscribe to config changes
    this.unsubscribeConfig = this.configService.onChange((config) => {
      if (this.deviceOpen) {
        this.renderButtons(config).catch(err => {
          console.error('[StreamDeckHW] Render error on config change:', err);
        });
      }
    });

    // Listen for button presses from worker
    this.unsubscribeDown = this.workerManager.on('device:down', (msg) => {
      this.onButtonPress(msg.slot);
    });

    // Listen for device errors from worker
    this.unsubscribeError = this.workerManager.on('device:error', (msg) => {
      console.error('[StreamDeckHW] Device error:', msg.error);
      this.handleDisconnect();
    });

    // Try initial connection
    await this.tryConnect();

    // Start reconnection polling
    this.reconnectTimer = setInterval(() => {
      if (!this.deviceOpen && this.workerManager.isReady()) {
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

      // Render current config
      await this.renderButtons(this.configService.getConfig());
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
          // Assigned button — render label text
          await this.workerManager.fillText(button.slot, button.label);
        } else {
          // Empty slot — black
          await this.workerManager.fillColor(button.slot, 0, 0, 0);
        }
      } catch (err) {
        console.error(`[StreamDeckHW] Failed to render button ${button.slot}:`, err);
      }
    }
  }

  private onButtonPress(slot: number): void {
    const config = this.configService.getConfig();
    const button = config.buttons.find(b => b.slot === slot);

    if (!button?.macroId) {
      console.log(`[StreamDeckHW] Button ${slot} pressed — no macro assigned`);
      return;
    }

    console.log(`[StreamDeckHW] Button ${slot} pressed — executing "${button.macroId}"`);

    executeExcaliburCommand(button.macroId, this.bridge)
      .then(result => {
        if (!result.success) {
          console.error(`[StreamDeckHW] Command "${button.macroId}" failed:`, result.error);
        }
      })
      .catch(err => {
        console.error(`[StreamDeckHW] Command "${button.macroId}" error:`, err);
      });
  }
}
