import streamDeck, { SingletonAction } from '@elgato/streamdeck';
import { readFileSync, watchFile, existsSync } from 'fs';
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
  shortcut: { key: string; modifiers: string[] } | null;
}

// Category labels for the dropdown groups
const CATEGORY_LABELS: Record<string, string> = {
  us: 'User Commands',
  cl: 'Clip',
  sq: 'Sequence',
  sl: 'Selection',
  ex: 'Export',
  pr: 'Project',
  pf: 'Preferences',
  sp: 'Special',
  vf: 'Video Effects',
  af: 'Audio Effects',
  vp: 'Video Presets',
  ap: 'Audio Presets',
  vt: 'Video Transitions',
  at: 'Audio Transitions',
};

// ---------------------------------------------------------------------------
// Read Excalibur files
// ---------------------------------------------------------------------------

function readExcaliburCommands(): ExcaliburCommand[] {
  try {
    const cmdlistRaw = existsSync(CMDLIST_PATH)
      ? readFileSync(CMDLIST_PATH, 'utf-8')
      : '{}';
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

    for (const [cat, entries] of Object.entries(cmdlist)) {
      const categoryLabel = CATEGORY_LABELS[cat] ?? cat;

      for (const [name, cmd] of Object.entries(entries)) {
        if (cmd.show !== 1) continue;

        commands.push({
          id: `${cat}:${name}`,
          name,
          category: cat,
          categoryLabel,
          shortcut: parseShortcut(shortcuts[name]),
        });
      }
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
    // Format: "key" or "key.mod1_mod2"
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
        `No shortcut for command "${settings.commandName}" — assign one in Excalibur Settings`,
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
      const commands = readExcaliburCommands();
      ev.action.sendToPropertyInspector({ event: 'commands', commands });
    }
  }
}

// ---------------------------------------------------------------------------
// Register & connect
// ---------------------------------------------------------------------------

streamDeck.actions.registerAction(new ExcaliburCommandAction());

// Watch Excalibur files for changes — no action needed here,
// the PI re-fetches on open. This just logs for debugging.
for (const filePath of [CMDLIST_PATH, SHORTCUTS_PATH]) {
  if (existsSync(filePath)) {
    watchFile(filePath, { interval: 5000 }, () => {
      streamDeck.logger.info(`Excalibur file changed: ${filePath}`);
    });
  }
}

streamDeck.connect();
