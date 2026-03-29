import fs from 'fs';
import path from 'path';
import os from 'os';

const SPELLBOOK_FILE = path.join(
  os.homedir(), 'Library', 'Application Support', 'SpellBook',
  'knights_of_the_editing_table.excalibur.json',
);

export interface HotkeyAssignment {
  commandName: string;
  key: string;
  keyCode: number;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  cmd: boolean;
}

/**
 * Reads hotkey assignments from SpellBook (written by Excalibur Settings).
 * Does NOT write to SpellBook — the user assigns hotkeys manually in Excalibur.
 */
export class ExcaliburHotkeyManager {
  constructor() {}

  /** Look up the hotkey for a command by reading SpellBook */
  getAssignment(commandName: string): HotkeyAssignment | null {
    if (!fs.existsSync(SPELLBOOK_FILE)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(SPELLBOOK_FILE, 'utf-8'));
      for (const cmd of Object.values(data.commands ?? {}) as any[]) {
        if (cmd.name === commandName && cmd.shortcut && cmd.shortcut.keyCode != null) {
          return {
            commandName,
            key: cmd.shortcut.key ?? '',
            keyCode: cmd.shortcut.keyCode,
            ctrl: !!cmd.shortcut.ctrl,
            alt: !!cmd.shortcut.alt,
            shift: !!cmd.shortcut.shift,
            cmd: !!cmd.shortcut.cmd,
          };
        }
      }
    } catch { /* SpellBook not readable */ }
    return null;
  }
}
