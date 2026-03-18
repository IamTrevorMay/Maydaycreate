import { GlobalKeyboardListener } from 'node-global-key-listener';
import type { IGlobalKeyEvent, IGlobalKeyDownMap } from 'node-global-key-listener';
import { chmodSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { createRequire } from 'module';

type BoostCallback = () => void;

const _require = createRequire(import.meta.url);

/**
 * Ensure the MacKeyServer binary is executable without using sudo-prompt.
 * Also monkey-patch sudo-prompt so the library never shows a password dialog.
 */
function patchMacKeyServerPerms(): void {
  if (process.platform !== 'darwin') return;
  try {
    // Make the binary executable ourselves (no sudo needed — we own the file)
    const libDir = dirname(_require.resolve('node-global-key-listener/package.json'));
    const binPath = join(libDir, 'bin', 'MacKeyServer');
    const stats = statSync(binPath);
    if (!(stats.mode & 0o111)) {
      chmodSync(binPath, stats.mode | 0o755);
      console.log('[Hotkeys] Made MacKeyServer binary executable');
    }
  } catch {
    // Binary might not exist — listener creation will fail gracefully
  }

  // Prevent the library from ever invoking sudo-prompt (which shows a
  // macOS password dialog). The binary is already executable.
  try {
    const sudoPrompt = _require('sudo-prompt');
    sudoPrompt.exec = (
      _cmd: string,
      _opts: unknown,
      cb?: (err: Error | null, stdout?: string, stderr?: string) => void,
    ) => {
      cb?.(null, '', '');
    };
  } catch {
    // sudo-prompt not installed — nothing to patch
  }
}

export class HotkeyService {
  private listener: GlobalKeyboardListener | null = null;
  private active = false;
  private onBoost: BoostCallback | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly AUTO_DISMISS_MS = 5000;

  async start() {
    // On macOS, check accessibility permission without prompting.
    // If not granted, skip the global key listener entirely — no native
    // subprocess is spawned and the user won't see a permission dialog.
    if (process.platform === 'darwin') {
      try {
        const { systemPreferences } = _require('electron');
        if (!systemPreferences.isTrustedAccessibilityClient(false)) {
          console.log('[Hotkeys] Accessibility permission not granted — global hotkeys disabled');
          console.log('[Hotkeys] To enable: System Settings → Privacy & Security → Accessibility → enable Mayday Create');
          return;
        }
      } catch {
        // Not running inside Electron (e.g. standalone server) — skip check
      }
    }

    // Ensure the native binary is executable and suppress sudo-prompt dialogs
    patchMacKeyServerPerms();

    try {
      this.listener = new GlobalKeyboardListener();
      this.listener.addListener(this.handleKey.bind(this));
      console.log('[Hotkeys] Global keyboard listener started (boost: B key)');
    } catch (err) {
      console.warn('[Hotkeys] Failed to start global key listener:', err);
    }
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
