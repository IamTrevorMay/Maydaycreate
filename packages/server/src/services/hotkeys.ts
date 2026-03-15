import { GlobalKeyboardListener } from 'node-global-key-listener';
import type { IGlobalKeyEvent, IGlobalKeyDownMap } from 'node-global-key-listener';

type BoostCallback = () => void;

export class HotkeyService {
  private listener: GlobalKeyboardListener | null = null;
  private active = false;
  private onBoost: BoostCallback | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly AUTO_DISMISS_MS = 5000;

  async start() {
    try {
      this.listener = new GlobalKeyboardListener();
      this.listener.addListener(this.handleKey.bind(this));
      console.log('[Hotkeys] Global keyboard listener started (boost: B key)');
      console.log('[Hotkeys] NOTE: On macOS, grant Accessibility permission if prompted');
    } catch (err) {
      console.warn('[Hotkeys] Failed to start global key listener:', err);
      console.warn('[Hotkeys] On macOS: System Settings → Privacy & Security → Accessibility → enable your terminal app');
    }

    // Catch async errors from the underlying native key server (e.g. sudo-prompt
    // uses APIs removed in Node 24+). Without this, the process crashes.
    process.on('uncaughtException', (err) => {
      if (
        err instanceof TypeError &&
        err.message.includes('isObject is not a function')
      ) {
        console.warn('[Hotkeys] Global key listener unavailable (Node compatibility issue) — hotkeys disabled');
        this.listener = null;
        return;
      }
      // Re-throw anything unrelated so it isn't silently swallowed
      throw err;
    });
  }

  stop() {
    if (this.listener) {
      this.listener.kill();
      this.listener = null;
    }
    this.setInactive();
  }

  /** Begin listening for boost key (B) with auto-dismiss */
  setActive(onBoost: BoostCallback) {
    this.active = true;
    this.onBoost = onBoost;
    this.resetDismissTimer();
    console.log('[Hotkeys] Activated — listening for B (boost)');
  }

  /** Stop listening */
  setInactive() {
    this.active = false;
    this.onBoost = null;
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  /** Reset the auto-dismiss countdown */
  resetDismissTimer() {
    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => {
      console.log('[Hotkeys] Auto-dismiss timeout');
      this.setInactive();
    }, HotkeyService.AUTO_DISMISS_MS);
  }

  private handleKey(e: IGlobalKeyEvent, down: IGlobalKeyDownMap) {
    if (e.state !== 'DOWN' || !this.active) return;

    // Ignore if any modifier is held
    if (down['LEFT META'] || down['RIGHT META'] || down['LEFT CTRL'] || down['RIGHT CTRL'] || down['LEFT ALT'] || down['RIGHT ALT']) {
      return;
    }

    if (e.name === 'B') {
      console.log('[Hotkeys] Boost captured');
      this.onBoost?.();
      this.setInactive();
    }
  }
}
