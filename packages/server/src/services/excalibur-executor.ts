import fs from 'fs';
import path from 'path';
import os from 'os';
import type { BridgeHandler } from '../bridge/handler.js';

const EXCALIBUR_DIR = path.join(
  os.homedir(), 'Library', 'Application Support',
  'Knights of the Editing Table', 'excalibur',
);

export interface ExcaliburResult {
  success: boolean;
  results?: string[];
  error?: string;
}

/**
 * Decode a Premiere Pro packed 64-bit color integer into ARGB (0-255 each).
 *
 * Premiere stores colors as 64-bit values with 16 bits per channel,
 * where the 8-bit color value occupies the upper byte of each 16-bit slot:
 *   Bits 63-48: Alpha (upper byte = alpha value)
 *   Bits 47-32: Red
 *   Bits 31-16: Green
 *   Bits 15-0:  Blue
 *
 * These values exceed Number.MAX_SAFE_INTEGER so we use BigInt for parsing.
 */
function decodePackedColor(packedStr: string): { a: number; r: number; g: number; b: number } | null {
  try {
    const big = BigInt(packedStr);
    const a = Number((big >> 56n) & 0xFFn);
    const r = Number((big >> 40n) & 0xFFn);
    const g = Number((big >> 24n) & 0xFFn);
    const b = Number((big >> 8n) & 0xFFn);
    return { a, r, g, b };
  } catch {
    return null;
  }
}

/**
 * Resolve the correct value for an Excalibur preset property.
 *
 * Excalibur's .presetaction.json stores values in two places:
 * - `CurrentValue`: sometimes correct, sometimes 0 or null
 * - `StartKeyframe`: always has the real value as "ticks,value,..."
 *
 * ParameterControlType (maps to After Effects PF_ParamType):
 *   0  = Layer reference — not settable
 *   1  = Integer (Seed, Edge Feather, Contrast, RGB values)
 *   2  = Float slider (Scale, Crop, Opacity, Blur Length)
 *   3  = Angle (Rotation, Direction, Skew Axis)
 *   4  = Boolean (Shadow Only, Monochrome, Clipping, etc.)
 *   5  = Color — settable via setColorValue(a, r, g, b)
 *   6  = 2D Point (Position, Anchor Point) — normalized x:y
 *   7  = Dropdown/enum (Film Size, Equalize, Operator, etc.)
 *   8  = Float slider (Lumetri: Temperature, Exposure, Shadows, etc.)
 *   9  = Curve/blob (base64) — not settable
 *   10 = Blob (base64) — not settable
 *   11 = Section toggle — UI-only collapse state, not settable
 *   12 = Internal boolean — not settable
 *   13 = Group start — UI-only, not settable
 *   14 = Group end — UI-only, not settable
 *   15 = Button — no data, not settable
 *   16 = Reserved boolean — not settable
 *   17 = Reserved — not settable
 *   18 = 3D Point — AE-only, not in Premiere
 */
function resolvePropertyValue(p: any): { value: any; colorARGB?: { a: number; r: number; g: number; b: number } } {
  const pct: number = p.ParameterControlType ?? -1;
  const cv = p.CurrentValue;
  const sk: string | undefined = typeof p.StartKeyframe === 'string' ? p.StartKeyframe : undefined;
  const name: string = p.Name ?? '';

  // Types that are never settable (no data, binary blobs, UI-only, reserved)
  if ([0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(pct)) {
    return { value: null };
  }

  // Type 5: Color — decode packed int64 from StartKeyframe, use setColorValue() in ExtendScript
  if (pct === 5) {
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2) {
        const argb = decodePackedColor(parts[1]);
        if (argb) return { value: 'color', colorARGB: argb };
      }
    }
    return { value: null };
  }

  // Type 6: 2D Point (Position, Anchor Point)
  // CurrentValue is always null; real value in StartKeyframe as "ticks,x:y,..."
  if (pct === 6) {
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2 && parts[1].includes(':')) {
        const [xStr, yStr] = parts[1].split(':');
        const x = parseFloat(xStr);
        const y = parseFloat(yStr);
        if (!isNaN(x) && !isNaN(y)) return { value: [x, y] };
      }
    }
    return { value: null };
  }

  // Types 2, 3, 8: Float/angle/slider
  // CurrentValue is often 0 when the real value is in StartKeyframe
  if ([2, 3, 8].includes(pct)) {
    if (cv != null && cv !== 0) return { value: cv };
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2) {
        const parsed = parseFloat(parts[1]);
        if (!isNaN(parsed)) return { value: parsed };
      }
    }
    return { value: cv ?? null };
  }

  // Type 1: Integer — CurrentValue is usually 0; real value in StartKeyframe
  if (pct === 1) {
    if (cv != null && cv !== 0) return { value: cv };
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2) {
        const parsed = parseInt(parts[1], 10);
        if (!isNaN(parsed)) return { value: parsed };
      }
    }
    return { value: cv ?? null };
  }

  // Type 4: Boolean — skip unnamed ("?"), resolve named booleans from StartKeyframe
  if (pct === 4) {
    if (!name || name === '?') return { value: null };
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2) {
        return { value: parts[1] === 'true' };
      }
    }
    return { value: null };
  }

  // Type 7: Dropdown/enum — integer index value
  if (pct === 7) {
    if (!name || name === '?') return { value: null };
    if (cv != null && cv !== 0) return { value: cv };
    if (sk) {
      const parts = sk.split(',');
      if (parts.length >= 2) {
        const parsed = parseInt(parts[1], 10);
        if (!isNaN(parsed)) return { value: parsed };
      }
    }
    return { value: null };
  }

  // Unknown/future PCT: attempt to use CurrentValue as fallback
  // This ensures new Excalibur parameter types aren't silently dropped
  if (cv != null && cv !== 0) return { value: cv };
  if (sk) {
    const parts = sk.split(',');
    if (parts.length >= 2) {
      const parsed = parseFloat(parts[1]);
      if (!isNaN(parsed)) return { value: parsed };
    }
  }
  return { value: cv ?? null };
}

export async function executeExcaliburCommand(
  commandName: string,
  bridge: BridgeHandler,
): Promise<ExcaliburResult> {
  if (!bridge.isConnected()) {
    return { success: false, error: 'Premiere Pro not connected. Open Premiere and the Mayday panel.' };
  }

  // Read command definition
  const cmdlistPath = path.join(EXCALIBUR_DIR, '.cmdlist.json');
  const presetPath = path.join(EXCALIBUR_DIR, '.presetaction.json');

  if (!fs.existsSync(cmdlistPath)) {
    return { success: false, error: 'Excalibur .cmdlist.json not found' };
  }

  const cmdlist = JSON.parse(fs.readFileSync(cmdlistPath, 'utf-8'));
  const userCmd = cmdlist?.us?.[commandName];
  if (!userCmd) {
    return { success: false, error: `Command "${commandName}" not found` };
  }

  const presets = fs.existsSync(presetPath)
    ? JSON.parse(fs.readFileSync(presetPath, 'utf-8'))
    : {};

  // Find the selected clip (priority: skip ahead of polling)
  const clipInfo = await bridge.callExtendScript('effects.getSelectedClipInfo', [], { priority: true }) as {
    trackIndex: number; clipIndex: number; trackType: string; clipName: string;
  } | null;

  if (!clipInfo) {
    return { success: false, error: 'No clip selected in Premiere Pro' };
  }

  const results: string[] = [];

  // Execute each module in the command
  const modules = userCmd.modules ?? {};
  for (const [_modKey, mod] of Object.entries(modules) as Array<[string, any]>) {
    const cmdID: string = mod.cmdID ?? '';
    const cmdName: string = mod.cmdName ?? '';
    const subMenu: any = mod.subMenu ?? {};

    if (cmdID === 'fxvp.' || cmdID === 'fxap.') {
      // Apply video/audio preset
      const presetCategory = cmdID === 'fxvp.' ? 'vp' : 'ap';
      const presetData = presets?.[presetCategory]?.[cmdName];

      if (!presetData) {
        results.push(`Preset "${cmdName}" not found in ${presetCategory}`);
        continue;
      }

      const effects = Array.isArray(presetData) ? presetData : [presetData];
      const effectsDefs = effects.map((e: any) => ({
        displayName: e.name,
        matchName: e.matchName ?? '',
        isIntrinsic: (e.matchName ?? '').indexOf('ADBE Motion') >= 0 ||
                     (e.matchName ?? '').indexOf('ADBE Opacity') >= 0 ||
                     (e.matchName ?? '').indexOf('ADBE Time Remapping') >= 0,
        properties: (e.props ?? []).filter((p: any) => p.Name).map((p: any) => {
          const resolved = resolvePropertyValue(p);
          const entry: any = {
            displayName: p.Name,
            matchName: p.matchName ?? '',
            value: resolved.value,
            type: p.ParameterControlType ?? (typeof resolved.value === 'number' ? 2 : 1),
            keyframes: null,
          };
          if (resolved.colorARGB) entry.colorARGB = resolved.colorARGB;
          return entry;
        }),
      }));

      const result = await bridge.callExtendScript('effects.applyEffects', [
        clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
        JSON.stringify(effectsDefs),
      ], { priority: true });
      results.push(`Applied preset "${cmdName}": ${JSON.stringify(result)}`);

    } else if (cmdID === 'fxcl.') {
      // Clip operation
      if (cmdName === 'Nest Individual Clips' || cmdName === 'Nest') {
        results.push(`Nest operation not yet supported via bridge`);
      } else if (subMenu?.selected === 'set') {
        const propName = cmdName;
        const value = subMenu.value != null ? parseFloat(subMenu.value) : null;
        const valueX = subMenu.valuex != null ? parseFloat(subMenu.valuex) : null;
        const valueY = subMenu.valuey != null ? parseFloat(subMenu.valuey) : null;

        const propDef: any = { displayName: propName, value: null };

        if (valueX != null && valueY != null) {
          // 2D point property (e.g., Position) — already in pixel coordinates
          propDef.value = [valueX, valueY];
          propDef.pixelValues = true;
        } else if (value != null) {
          propDef.value = value;
        }

        if (propDef.value != null) {
          const effectsDef = [{
            displayName: 'Motion',
            isIntrinsic: true,
            properties: [propDef],
          }];

          if (propName === 'Volume' || propName === 'Level') {
            effectsDef[0].displayName = 'Volume';
          }

          const result = await bridge.callExtendScript('effects.applyEffects', [
            clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
            JSON.stringify(effectsDef),
          ], { priority: true });
          results.push(`Set ${propName}: ${JSON.stringify(result)}`);
        } else {
          results.push(`No value for ${propName}`);
        }
      } else if (subMenu?.selected === 'atclips') {
        const presetData = presets?.['ap']?.[cmdName] ?? presets?.['vp']?.[cmdName];
        if (presetData) {
          const effects = Array.isArray(presetData) ? presetData : [presetData];
          const effectsDefs = effects.map((e: any) => ({
            displayName: e.name,
            matchName: e.matchName ?? '',
            isIntrinsic: (e.matchName ?? '').indexOf('ADBE Motion') >= 0 ||
                         (e.matchName ?? '').indexOf('ADBE Opacity') >= 0 ||
                         (e.matchName ?? '').indexOf('ADBE Time Remapping') >= 0,
            properties: (e.props ?? []).filter((p: any) => p.Name).map((p: any) => {
              const resolved = resolvePropertyValue(p);
              const entry: any = {
                displayName: p.Name,
                matchName: p.matchName ?? '',
                value: resolved.value,
                type: p.ParameterControlType ?? (typeof resolved.value === 'number' ? 2 : 1),
                keyframes: null,
              };
              if (resolved.colorARGB) entry.colorARGB = resolved.colorARGB;
              return entry;
            }),
          }));

          const result = await bridge.callExtendScript('effects.applyEffects', [
            clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
            JSON.stringify(effectsDefs),
          ], { priority: true });
          results.push(`Applied "${cmdName}": ${JSON.stringify(result)}`);
        } else {
          results.push(`Preset "${cmdName}" not found`);
        }
      } else {
        results.push(`Unknown fxcl operation: ${cmdName} (${JSON.stringify(subMenu)})`);
      }
    } else {
      results.push(`Unknown command type: ${cmdID}`);
    }
  }

  console.log(`[Excalibur] Executed "${commandName}":`, results);
  return { success: true, results };
}

/** Read available Excalibur user commands from .cmdlist.json */
export function readExcaliburCommands(): Array<{ id: string; name: string }> {
  try {
    if (!fs.existsSync(path.join(EXCALIBUR_DIR, '.cmdlist.json'))) return [];

    const cmdlist = JSON.parse(
      fs.readFileSync(path.join(EXCALIBUR_DIR, '.cmdlist.json'), 'utf-8'),
    ) as Record<string, Record<string, { show?: number }>>;

    const commands: Array<{ id: string; name: string }> = [];
    const userEntries = cmdlist['us'] ?? {};

    for (const [name, cmd] of Object.entries(userEntries)) {
      if (cmd.show !== 1) continue;
      commands.push({ id: name, name });
    }

    return commands;
  } catch (err) {
    console.error('[Excalibur] Failed to read commands:', err);
    return [];
  }
}
