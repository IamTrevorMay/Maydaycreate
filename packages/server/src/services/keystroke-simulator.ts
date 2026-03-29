import { execFile } from 'child_process';
import path from 'path';
import type { HotkeyAssignment } from './excalibur-hotkeys.js';

// Path to the compiled Swift CGEvent binary
// In dev: monorepo tools directory
// In packaged: resources/tools directory
let binaryPath: string | null = null;

function getBinaryPath(): string {
  if (binaryPath) return binaryPath;

  // Try dev path first
  const devPath = path.join(process.cwd(), 'tools', 'keystroke-sender', 'keystroke-sender');
  // Try monorepo root (when running from packages/server)
  const monorepoPath = path.join(process.cwd(), '..', '..', 'tools', 'keystroke-sender', 'keystroke-sender');
  // Try relative to this file
  const relativePath = path.resolve(__dirname, '..', '..', '..', '..', 'tools', 'keystroke-sender', 'keystroke-sender');

  for (const p of [devPath, monorepoPath, relativePath]) {
    try {
      const fs = require('fs');
      if (fs.existsSync(p)) {
        binaryPath = p;
        return p;
      }
    } catch { /* continue */ }
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
