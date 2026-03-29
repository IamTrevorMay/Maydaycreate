import fs from 'fs';
import path from 'path';
import os from 'os';

const SPELLBOOK_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'SpellBook');
const SPELLBOOK_FILE = path.join(SPELLBOOK_DIR, 'knights_of_the_editing_table.excalibur.json');

export interface HotkeyAssignment {
  commandName: string;
  key: string;       // Display name e.g. "F13"
  keyCode: number;   // macOS virtual key code
  ctrl: boolean;
  alt: boolean;      // Option key
  shift: boolean;
  cmd: boolean;
}

// macOS virtual key codes for F-keys
const F_KEY_CODES: Record<string, number> = {
  F13: 105, F14: 107, F15: 113, F16: 106, F17: 64, F18: 79, F19: 80, F20: 90,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97, F7: 98, F8: 100,
  F9: 101, F10: 109, F11: 103, F12: 111,
};

// Hotkey pool: Ctrl+Opt+F13-F20, then Ctrl+Opt+Shift+F13-F20, etc.
function generateHotkeyPool(): Array<Omit<HotkeyAssignment, 'commandName'>> {
  const pool: Array<Omit<HotkeyAssignment, 'commandName'>> = [];
  const fKeyOrder = ['F13','F14','F15','F16','F17','F18','F19','F20','F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12'];
  const modCombos = [
    { ctrl: true, alt: true, shift: false, cmd: false },
    { ctrl: true, alt: true, shift: true, cmd: false },
    { ctrl: true, alt: false, shift: false, cmd: false },
    { ctrl: true, alt: false, shift: true, cmd: false },
  ];

  for (const mods of modCombos) {
    for (const fk of fKeyOrder) {
      pool.push({ key: fk, keyCode: F_KEY_CODES[fk], ...mods });
    }
  }
  return pool;
}

const HOTKEY_POOL = generateHotkeyPool();

export class ExcaliburHotkeyManager {
  private assignments = new Map<string, HotkeyAssignment>();
  private persistPath: string;

  constructor(dataDir: string) {
    this.persistPath = path.join(dataDir, 'excalibur-hotkey-assignments.json');
    this.load();
  }

  getAssignment(commandName: string): HotkeyAssignment | null {
    return this.assignments.get(commandName) ?? null;
  }

  assignHotkey(commandName: string): HotkeyAssignment {
    const existing = this.assignments.get(commandName);
    if (existing) return existing;

    const usedKeys = new Set(
      [...this.assignments.values()].map(a => `${a.keyCode}-${a.ctrl}-${a.alt}-${a.shift}-${a.cmd}`),
    );

    // Also avoid keys already in SpellBook (manually assigned by user)
    const spellbookUsed = this.readSpellBookUsedKeys();
    for (const key of spellbookUsed) usedKeys.add(key);

    for (const slot of HOTKEY_POOL) {
      const slotKey = `${slot.keyCode}-${slot.ctrl}-${slot.alt}-${slot.shift}-${slot.cmd}`;
      if (!usedKeys.has(slotKey)) {
        const assignment: HotkeyAssignment = { commandName, ...slot };
        this.assignments.set(commandName, assignment);
        this.save();
        return assignment;
      }
    }

    throw new Error('No free hotkey slots available');
  }

  removeAssignment(commandName: string): void {
    this.assignments.delete(commandName);
    this.save();
  }

  /** Write all Mayday hotkey assignments into the SpellBook JSON */
  syncToSpellBook(): void {
    let spellbook: any = { extID: 'knights_of_the_editing_table.excalibur', name: 'Excalibur', commands: {} };

    if (fs.existsSync(SPELLBOOK_FILE)) {
      try {
        spellbook = JSON.parse(fs.readFileSync(SPELLBOOK_FILE, 'utf-8'));
      } catch { /* start fresh */ }
    }
    if (!spellbook.commands) spellbook.commands = {};

    // Remove previous Mayday entries
    for (const key of Object.keys(spellbook.commands)) {
      if (key.startsWith('mayday.')) delete spellbook.commands[key];
    }

    // Add current assignments
    for (const [commandName, assignment] of this.assignments) {
      const cmdId = 'mayday.' + commandName.replace(/ /g, '_');
      spellbook.commands[cmdId] = {
        name: commandName,
        shortcut: {
          key: assignment.key,
          keyCode: assignment.keyCode,
          cmd: assignment.cmd,
          ctrl: assignment.ctrl,
          alt: assignment.alt,
          shift: assignment.shift,
          fn: false,
        },
      };
    }

    fs.mkdirSync(SPELLBOOK_DIR, { recursive: true });
    const tmpFile = SPELLBOOK_FILE + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(spellbook));
    fs.renameSync(tmpFile, SPELLBOOK_FILE);

    console.log(`[ExcaliburHotkeys] Synced ${this.assignments.size} hotkey(s) to SpellBook`);
  }

  getAllAssignments(): Map<string, HotkeyAssignment> {
    return new Map(this.assignments);
  }

  private readSpellBookUsedKeys(): Set<string> {
    const used = new Set<string>();
    if (!fs.existsSync(SPELLBOOK_FILE)) return used;
    try {
      const data = JSON.parse(fs.readFileSync(SPELLBOOK_FILE, 'utf-8'));
      for (const [id, cmd] of Object.entries(data.commands ?? {}) as any[]) {
        // Skip our own entries
        if (id.startsWith('mayday.')) continue;
        if (cmd.shortcut) {
          const s = cmd.shortcut;
          used.add(`${s.keyCode}-${!!s.ctrl}-${!!s.alt}-${!!s.shift}-${!!s.cmd}`);
        }
      }
    } catch { /* ignore */ }
    return used;
  }

  private load(): void {
    if (!fs.existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.persistPath, 'utf-8'));
      for (const a of data) {
        this.assignments.set(a.commandName, a);
      }
      console.log(`[ExcaliburHotkeys] Loaded ${this.assignments.size} hotkey assignment(s)`);
    } catch { /* start fresh */ }
  }

  private save(): void {
    const dir = path.dirname(this.persistPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.persistPath, JSON.stringify([...this.assignments.values()], null, 2));
  }
}
