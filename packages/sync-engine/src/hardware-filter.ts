/**
 * Hardware-specific config keys that should NOT be synced across machines.
 * Audio device names, monitor layouts, etc. vary per hardware.
 */

const HARDWARE_SPECIFIC_KEYS = new Set([
  'audioDeviceInput',
  'audioDeviceOutput',
  'audioDeviceSampleRate',
  'audioDeviceBufferSize',
  'monitorLayout',
  'displayBrightness',
  'displayColorProfile',
  'defaultAudioDevice',
  'audioInterface',
]);

const HARDWARE_SPECIFIC_PATH_PATTERNS = [
  /^hotkeys\/hardware\//,
  /^workspaces\/monitor-/,
];

/**
 * Returns true if the relative path or config key is hardware-specific and
 * should be skipped during sync.
 */
export function isHardwareSpecific(relativePath: string): boolean {
  for (const pattern of HARDWARE_SPECIFIC_PATH_PATTERNS) {
    if (pattern.test(relativePath)) return true;
  }
  return false;
}

/**
 * Filters hardware-specific keys from a config object in place.
 * Used when preparing plugin configs for sync.
 */
export function filterHardwareKeys(config: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (!HARDWARE_SPECIFIC_KEYS.has(key)) {
      result[key] = value;
    }
  }
  return result;
}
