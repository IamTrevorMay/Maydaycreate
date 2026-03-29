import { execFile } from 'child_process';
import type { HotkeyAssignment } from './excalibur-hotkeys.js';

/**
 * Simulate a keystroke on macOS using osascript (System Events).
 * This triggers SpellBook's global key listener, which dispatches
 * the key event to Excalibur for command execution.
 */
export function simulateKeystroke(assignment: HotkeyAssignment): Promise<void> {
  return new Promise((resolve, reject) => {
    // Build the AppleScript "using" modifiers clause
    const modifiers: string[] = [];
    if (assignment.ctrl) modifiers.push('control down');
    if (assignment.alt) modifiers.push('option down');
    if (assignment.shift) modifiers.push('shift down');
    if (assignment.cmd) modifiers.push('command down');

    const usingClause = modifiers.length > 0
      ? ` using {${modifiers.join(', ')}}`
      : '';

    const script = `tell application "System Events" to key code ${assignment.keyCode}${usingClause}`;

    execFile('osascript', ['-e', script], { timeout: 3000 }, (err) => {
      if (err) {
        console.error('[KeystrokeSimulator] Failed:', err.message);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
