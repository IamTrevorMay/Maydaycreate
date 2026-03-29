import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { HotkeyAssignment } from './excalibur-hotkeys.js';

let binaryPath: string | null = null;

function getBinaryPath(): string {
  if (binaryPath) return binaryPath;

  const candidates = [
    path.join(process.cwd(), 'tools', 'keystroke-sender', 'keystroke-sender'),
    path.join(process.cwd(), '..', '..', 'tools', 'keystroke-sender', 'keystroke-sender'),
  ];

  // Try import.meta.url based path
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(thisDir, '..', '..', '..', '..', 'tools', 'keystroke-sender', 'keystroke-sender'));
    candidates.push(path.resolve(thisDir, '..', 'tools', 'keystroke-sender', 'keystroke-sender'));
  } catch { /* import.meta.url not available */ }

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      binaryPath = p;
      return p;
    }
  }

  throw new Error('keystroke-sender binary not found. Run: cd tools/keystroke-sender && swiftc -O -o keystroke-sender keystroke-sender.swift');
}

/**
 * Simulate a keystroke via CGEvents using the compiled Swift binary.
 * CGEvents post at the HID system level, which SpellBook's spell_mac catches.
 */
export function simulateKeystroke(assignment: HotkeyAssignment): Promise<void> {
  return new Promise((resolve, reject) => {
    const args: string[] = [String(assignment.keyCode)];
    if (assignment.cmd) args.push('--cmd');
    if (assignment.alt) args.push('--alt');
    if (assignment.shift) args.push('--shift');
    if (assignment.ctrl) args.push('--ctrl');

    execFile(getBinaryPath(), args, { timeout: 3000 }, (err) => {
      if (err) {
        console.error('[KeystrokeSimulator] Failed:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
