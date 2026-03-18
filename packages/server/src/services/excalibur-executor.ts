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
        properties: (e.props ?? []).map((p: any) => ({
          displayName: p.Name,
          matchName: p.matchName ?? '',
          value: p.CurrentValue,
          type: typeof p.CurrentValue === 'number' ? 2 : 1,
          keyframes: null,
        })),
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
          propDef.value = value;
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
            isIntrinsic: false,
            properties: (e.props ?? []).map((p: any) => ({
              displayName: p.Name,
              matchName: p.matchName ?? '',
              value: p.CurrentValue,
              type: typeof p.CurrentValue === 'number' ? 2 : 1,
              keyframes: null,
            })),
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
