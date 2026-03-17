import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { exec } from 'child_process';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const EXCALIBUR_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'Knights of the Editing Table',
  'excalibur',
);
const CMDLIST_PATH = join(EXCALIBUR_DIR, '.cmdlist.json');
const SHORTCUTS_PATH = join(EXCALIBUR_DIR, '.shortcuts.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandSettings {
  commandId?: string;
  commandName?: string;
  category?: string;
  shortcutKey?: string;
  shortcutModifiers?: string[];
}

interface ExcaliburCommand {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  shortcut: { key: string; modifiers: string[] };
}

// Auto-assigned shortcut keys: Ctrl+Shift+Option + key
// These obscure combos won't conflict with normal Premiere shortcuts
const AUTO_SHORTCUT_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
  'q', 'w', 'e', 'r', 'y', 'u', 'p',
  'g', 'h', 'k', 'l',
  'z', 'x', 'b', 'n',
];

// ---------------------------------------------------------------------------
// Read & auto-assign shortcuts
// ---------------------------------------------------------------------------

function readShortcuts(): Record<string, string | { a?: string; v?: string }> {
  try {
    if (!existsSync(SHORTCUTS_PATH)) return {};
    return JSON.parse(readFileSync(SHORTCUTS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeShortcuts(shortcuts: Record<string, string | { a?: string; v?: string }>): void {
  try {
    writeFileSync(SHORTCUTS_PATH, JSON.stringify(shortcuts), 'utf-8');
    streamDeck.logger.info('Updated Excalibur shortcuts file');
  } catch (err) {
    streamDeck.logger.error('Failed to write shortcuts:', err);
  }
}

/**
 * Ensure every visible user command has a shortcut assigned.
 * Auto-assigns Ctrl+Shift+Option+key for commands without one.
 */
function ensureShortcuts(): void {
  try {
    if (!existsSync(CMDLIST_PATH)) return;

    const cmdlist = JSON.parse(readFileSync(CMDLIST_PATH, 'utf-8')) as Record<
      string,
      Record<string, { show?: number }>
    >;
    const shortcuts = readShortcuts();

    const userEntries = cmdlist['us'] ?? {};
    const userNames = Object.keys(userEntries).filter(
      (name) => userEntries[name].show === 1,
    );

    // Find which keys are already in use
    const usedKeys = new Set<string>();
    for (const val of Object.values(shortcuts)) {
      if (typeof val === 'string') {
        const dotIdx = val.indexOf('.');
        const key = dotIdx === -1 ? val : val.slice(0, dotIdx);
        // Only track keys that use our modifier combo
        if (typeof val === 'string' && val.includes('ctrl') && val.includes('alt') && val.includes('m')) {
          usedKeys.add(key);
        }
      }
    }

    let dirty = false;
    let keyIdx = 0;

    for (const name of userNames) {
      if (shortcuts[name]) continue; // already has a shortcut

      // Find next available key
      while (keyIdx < AUTO_SHORTCUT_KEYS.length && usedKeys.has(AUTO_SHORTCUT_KEYS[keyIdx])) {
        keyIdx++;
      }
      if (keyIdx >= AUTO_SHORTCUT_KEYS.length) {
        streamDeck.logger.warn(`Ran out of auto-shortcut keys at command "${name}"`);
        break;
      }

      const key = AUTO_SHORTCUT_KEYS[keyIdx];
      // Excalibur format: "key.mod1_mod2" where m=shift
      shortcuts[name] = `${key}.m_alt_ctrl`;
      usedKeys.add(key);
      keyIdx++;
      dirty = true;

      streamDeck.logger.info(`Auto-assigned shortcut Ctrl+Shift+Option+${key.toUpperCase()} to "${name}"`);
    }

    if (dirty) {
      writeShortcuts(shortcuts);
    }
  } catch (err) {
    streamDeck.logger.error('ensureShortcuts failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Read commands (with guaranteed shortcuts)
// ---------------------------------------------------------------------------

function readExcaliburCommands(): ExcaliburCommand[] {
  try {
    if (!existsSync(CMDLIST_PATH)) return [];

    const cmdlistRaw = readFileSync(CMDLIST_PATH, 'utf-8');
    const shortcutsRaw = existsSync(SHORTCUTS_PATH)
      ? readFileSync(SHORTCUTS_PATH, 'utf-8')
      : '{}';

    const cmdlist = JSON.parse(cmdlistRaw) as Record<
      string,
      Record<string, { show?: number }>
    >;
    const shortcuts = JSON.parse(shortcutsRaw) as Record<
      string,
      string | { a?: string; v?: string }
    >;

    const commands: ExcaliburCommand[] = [];

    const userEntries = cmdlist['us'] ?? {};
    for (const [name, cmd] of Object.entries(userEntries)) {
      if (cmd.show !== 1) continue;

      const shortcut = parseShortcut(shortcuts[name]);
      if (!shortcut) continue; // shouldn't happen after ensureShortcuts

      commands.push({
        id: `us:${name}`,
        name,
        category: 'us',
        categoryLabel: 'User Commands',
        shortcut,
      });
    }

    return commands;
  } catch (err) {
    streamDeck.logger.error('Failed to read Excalibur commands:', err);
    return [];
  }
}

function parseShortcut(
  raw: string | { a?: string; v?: string } | undefined | null,
): { key: string; modifiers: string[] } | null {
  if (!raw) return null;

  if (typeof raw === 'string') {
    const dotIdx = raw.indexOf('.');
    if (dotIdx === -1) {
      return raw ? { key: raw, modifiers: [] } : null;
    }
    const key = raw.slice(0, dotIdx);
    const modsStr = raw.slice(dotIdx + 1);
    const modifiers = modsStr
      .split('_')
      .map((m) => m.replace(/^m$/, 'shift'))
      .filter(Boolean);
    return key ? { key, modifiers } : null;
  }

  if (typeof raw === 'object') {
    if (!raw.v) return null;
    const modifiers: string[] = [];
    if (raw.a) modifiers.push(raw.a);
    return { key: raw.v, modifiers };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Simulate keystrokes (macOS)
// ---------------------------------------------------------------------------

const MOD_MAP: Record<string, string> = {
  cmd: 'command down',
  command: 'command down',
  shift: 'shift down',
  m: 'shift down',
  alt: 'option down',
  option: 'option down',
  ctrl: 'control down',
  control: 'control down',
};

function simulateKeystroke(key: string, modifiers: string[]): void {
  const mods = modifiers.map((m) => MOD_MAP[m.toLowerCase()]).filter(Boolean);

  let script: string;
  if (mods.length > 0) {
    script = `tell application "System Events" to keystroke "${key}" using {${mods.join(', ')}}`;
  } else {
    script = `tell application "System Events" to keystroke "${key}"`;
  }

  exec(`osascript -e '${script}'`, (err) => {
    if (err) {
      streamDeck.logger.error('AppleScript keystroke failed:', err.message);
    }
  });
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

class ExcaliburCommandAction extends SingletonAction {
  override readonly manifestId = 'com.mayday.excalibur.command';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onWillAppear(ev: any): void {
    const settings = ev.payload.settings as CommandSettings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async onKeyDown(ev: any): Promise<void> {
    const settings = ev.payload.settings as CommandSettings;

    if (!settings.shortcutKey) {
      streamDeck.logger.warn(
        `No shortcut for command "${settings.commandName}"`,
      );
      await ev.action.showAlert();
      return;
    }

    try {
      simulateKeystroke(settings.shortcutKey, settings.shortcutModifiers ?? []);
    } catch (err) {
      streamDeck.logger.error('Keystroke simulation failed:', err);
      await ev.action.showAlert();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onDidReceiveSettings(ev: any): void {
    const settings = ev.payload.settings as CommandSettings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override onSendToPlugin(ev: any): void {
    const payload = ev.payload as { event?: string };

    if (payload.event === 'getCommands') {
      // Ensure shortcuts exist before sending command list
      ensureShortcuts();
      const commands = readExcaliburCommands();
      streamDeck.ui.sendToPropertyInspector({ event: 'commands', commands });
    }
  }
}

// ---------------------------------------------------------------------------
// Register & connect
// ---------------------------------------------------------------------------

streamDeck.actions.registerAction(new ExcaliburCommandAction());

// Auto-assign shortcuts on startup
ensureShortcuts();

// Re-check when Excalibur files change (new commands added)
for (const filePath of [CMDLIST_PATH, SHORTCUTS_PATH]) {
  if (existsSync(filePath)) {
    watchFile(filePath, { interval: 5000 }, () => {
      streamDeck.logger.info(`Excalibur file changed: ${filePath}`);
      ensureShortcuts();
    });
  }
}

streamDeck.connect();
