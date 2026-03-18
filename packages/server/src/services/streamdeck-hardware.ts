// TODO: Hardware control is currently disabled. To enable:
//   1. npm install @elgato-stream-deck/node @napi-rs/canvas -w @mayday/server
//   2. Run electron-rebuild to compile native modules for Electron's Node
//   3. Add both packages to --external in the server tsup build script
// Without electron-rebuild, the native .node binaries (node-hid, skia) segfault
// inside Electron's runtime. The dynamic imports below gracefully degrade when
// the packages are missing.

import type { StreamDeckConfigService, StreamDeckConfig } from './streamdeck-config.js';
import type { BridgeHandler } from '../bridge/handler.js';
import { executeExcaliburCommand } from './excalibur-executor.js';

// Dynamic imports for optional native dependencies
let streamDeckLib: typeof import('@elgato-stream-deck/node') | null = null;
let canvasLib: typeof import('@napi-rs/canvas') | null = null;

export interface StreamDeckStatus {
  connected: boolean;
  deviceType: string | null;
  serialNumber: string | null;
  error: string | null;
}

export class StreamDeckHardwareService {
  private configService: StreamDeckConfigService;
  private bridge: BridgeHandler;
  private device: any = null;
  private unsubscribeConfig: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setInterval> | null = null;
  private status: StreamDeckStatus = {
    connected: false,
    deviceType: null,
    serialNumber: null,
    error: null,
  };

  constructor(configService: StreamDeckConfigService, bridge: BridgeHandler) {
    this.configService = configService;
    this.bridge = bridge;
  }

  async start(): Promise<void> {
    // Try to load native dependencies
    try {
      streamDeckLib = await import('@elgato-stream-deck/node');
    } catch {
      this.status.error = '@elgato-stream-deck/node not available';
      console.warn('[StreamDeckHW] @elgato-stream-deck/node not available — hardware control disabled');
      return;
    }

    try {
      canvasLib = await import('@napi-rs/canvas');
    } catch {
      console.warn('[StreamDeckHW] @napi-rs/canvas not available — will use plain color buttons');
    }

    // Subscribe to config changes
    this.unsubscribeConfig = this.configService.onChange((config) => {
      if (this.device) {
        this.renderButtons(config).catch(err => {
          console.error('[StreamDeckHW] Render error on config change:', err);
        });
      }
    });

    // Try initial connection
    await this.tryConnect();

    // Start reconnection polling
    this.reconnectTimer = setInterval(() => {
      if (!this.device) {
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
    if (this.device) {
      try { this.device.close(); } catch {}
      this.device = null;
    }
    this.status.connected = false;
    this.status.deviceType = null;
    this.status.serialNumber = null;
  }

  getStatus(): StreamDeckStatus {
    return { ...this.status };
  }

  private async tryConnect(): Promise<void> {
    if (!streamDeckLib) return;

    try {
      const devices = await streamDeckLib.listStreamDecks();
      if (devices.length === 0) return;

      const deviceInfo = devices[0];
      this.device = await streamDeckLib.openStreamDeck(deviceInfo.path);

      this.status.connected = true;
      this.status.deviceType = deviceInfo.model?.toString() ?? 'StreamDeck';
      this.status.serialNumber = deviceInfo.serialNumber ?? null;
      this.status.error = null;

      console.log(`[StreamDeckHW] Connected: ${this.status.deviceType} (${this.status.serialNumber})`);

      // Listen for button presses
      this.device.on('down', (slot: number) => {
        this.onButtonPress(slot);
      });

      // Handle disconnect
      this.device.on('error', (err: Error) => {
        console.error('[StreamDeckHW] Device error:', err.message);
        this.handleDisconnect();
      });

      // Render current config
      await this.renderButtons(this.configService.getConfig());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only log if it's not just "no devices"
      if (!msg.includes('No Stream Deck')) {
        this.status.error = msg;
        console.warn('[StreamDeckHW] Connection attempt failed:', msg);
      }
    }
  }

  private handleDisconnect(): void {
    this.device = null;
    this.status.connected = false;
    this.status.deviceType = null;
    this.status.serialNumber = null;
    console.log('[StreamDeckHW] Disconnected');
  }

  private async renderButtons(config: StreamDeckConfig): Promise<void> {
    if (!this.device) return;

    for (const button of config.buttons) {
      try {
        if (button.label) {
          const buffer = await this.renderTextButton(button.label);
          if (buffer) {
            await this.device.fillKeyBuffer(button.slot, buffer);
          } else {
            // Fallback: clear with a dark color
            await this.device.fillKeyColor(button.slot, 40, 40, 40);
          }
        } else {
          // Empty slot — fill black
          await this.device.fillKeyColor(button.slot, 0, 0, 0);
        }
      } catch (err) {
        console.error(`[StreamDeckHW] Failed to render button ${button.slot}:`, err);
      }
    }
  }

  private async renderTextButton(label: string): Promise<Buffer | null> {
    if (!canvasLib) return null;

    const size = 72;
    const canvas = canvasLib.createCanvas(size, size);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#333333';
    ctx.fillRect(0, 0, size, size);

    // Text
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Auto-size font based on label length
    const fontSize = label.length > 12 ? 10 : label.length > 8 ? 12 : 14;
    ctx.font = `bold ${fontSize}px sans-serif`;

    // Word wrap for long labels
    const words = label.split(/[\s-]+/);
    if (words.length > 1 && label.length > 8) {
      const mid = Math.ceil(words.length / 2);
      const line1 = words.slice(0, mid).join(' ');
      const line2 = words.slice(mid).join(' ');
      ctx.fillText(line1, size / 2, size / 2 - fontSize * 0.6, size - 8);
      ctx.fillText(line2, size / 2, size / 2 + fontSize * 0.6, size - 8);
    } else {
      ctx.fillText(label, size / 2, size / 2, size - 8);
    }

    // Convert to raw pixel buffer (RGBA → RGB for Stream Deck)
    const imageData = ctx.getImageData(0, 0, size, size);
    const rgbBuffer = Buffer.alloc(size * size * 3);
    for (let i = 0; i < size * size; i++) {
      rgbBuffer[i * 3] = imageData.data[i * 4];
      rgbBuffer[i * 3 + 1] = imageData.data[i * 4 + 1];
      rgbBuffer[i * 3 + 2] = imageData.data[i * 4 + 2];
    }

    return rgbBuffer;
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
