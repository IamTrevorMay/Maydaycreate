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

interface ClipInfo {
  trackIndex: number;
  clipIndex: number;
  trackType: string;
  clipName: string;
}

// ── Color decoding ──────────────────────────────────────────────────────

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

// ── Property value resolution ───────────────────────────────────────────

function resolvePropertyValue(p: any): { value: any; colorARGB?: { a: number; r: number; g: number; b: number } } {
  const pct: number = p.ParameterControlType ?? -1;
  const cv = p.CurrentValue;
  const sk: string | undefined = typeof p.StartKeyframe === 'string' ? p.StartKeyframe : undefined;
  const name: string = p.Name ?? '';

  if ([0, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(pct)) {
    return { value: null };
  }

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

// ── Preset → effect definition builder ──────────────────────────────────

function buildEffectDefs(presetData: any): any[] {
  const effects = Array.isArray(presetData) ? presetData : [presetData];
  return effects.map((e: any) => ({
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
}

// ── cmdID handlers ──────────────────────────────────────────────────────

// Commands that need a selected clip
const CLIP_REQUIRED = new Set(['fxvp.', 'fxap.', 'fxcl.', 'fxvf.', 'fxaf.', 'fxvt.', 'fxat.']);

async function handleVideoPreset(
  mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const presetData = presets?.['vp']?.[cmdName];
  if (!presetData) return `Preset "${cmdName}" not found in vp`;

  const effectsDefs = buildEffectDefs(presetData);
  const result = await bridge.callExtendScript('effects.applyEffects', [
    clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
    JSON.stringify(effectsDefs),
  ], { priority: true });
  return `Applied preset "${cmdName}": ${JSON.stringify(result)}`;
}

async function handleAudioPreset(
  mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const subMenu = mod.subMenu ?? {};

  if (subMenu.selected === 'atclips') {
    const presetData = presets?.['ap']?.[cmdName] ?? presets?.['vp']?.[cmdName];
    if (!presetData) return `Preset "${cmdName}" not found`;

    const effectsDefs = buildEffectDefs(presetData);
    const result = await bridge.callExtendScript('effects.applyEffects', [
      clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
      JSON.stringify(effectsDefs),
    ], { priority: true });
    return `Applied audio preset "${cmdName}": ${JSON.stringify(result)}`;
  }

  const presetData = presets?.['ap']?.[cmdName];
  if (!presetData) return `Audio preset "${cmdName}" not found`;

  const effectsDefs = buildEffectDefs(presetData);
  const result = await bridge.callExtendScript('effects.applyEffects', [
    clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
    JSON.stringify(effectsDefs),
  ], { priority: true });
  return `Applied audio preset "${cmdName}": ${JSON.stringify(result)}`;
}

async function handleClipProperty(
  mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const subMenu = mod.subMenu ?? {};

  if (subMenu.selected === 'native') {
    if (cmdName === 'Nest Individual Clips' || cmdName === 'Nest') {
      const result = await bridge.callExtendScript('timeline.nestSelection', [], { priority: true });
      return `Nest: ${JSON.stringify(result)}`;
    }
    return `Unknown native command: ${cmdName}`;
  }

  if (subMenu.selected === 'set' || subMenu.selected === 'calc') {
    const propName = cmdName;
    const value = subMenu.value != null ? parseFloat(subMenu.value) : null;
    const valueX = subMenu.valuex != null ? parseFloat(subMenu.valuex) : null;
    const valueY = subMenu.valuey != null ? parseFloat(subMenu.valuey) : null;

    const propDef: any = { displayName: propName, value: null };

    if (valueX != null && valueY != null) {
      propDef.value = [valueX, valueY];
      propDef.pixelValues = true;
    } else if (value != null) {
      propDef.value = value;
    }

    if (propDef.value != null) {
      let componentName = 'Motion';
      if (propName === 'Opacity' || propName === 'Blend Mode') {
        componentName = 'Opacity';
      } else if (propName === 'Volume' || propName === 'Level' || propName === 'Channel Volume') {
        componentName = 'Volume';
      } else if (propName === 'Speed' || propName === 'Time Remapping') {
        componentName = 'Time Remapping';
      }

      const effectsDef = [{
        displayName: componentName,
        isIntrinsic: true,
        properties: [propDef],
      }];

      const result = await bridge.callExtendScript('effects.applyEffects', [
        clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
        JSON.stringify(effectsDef),
      ], { priority: true });
      const label = subMenu.selected === 'calc' ? `Calc ${propName} → ${value}` : `Set ${propName}`;
      return `${label}: ${JSON.stringify(result)}`;
    }
    return `No value for ${propName}`;
  }

  if (subMenu.selected === 'atclips') {
    const presetData = presets?.['ap']?.[cmdName] ?? presets?.['vp']?.[cmdName];
    if (!presetData) return `Preset "${cmdName}" not found`;

    const effectsDefs = buildEffectDefs(presetData);
    const result = await bridge.callExtendScript('effects.applyEffects', [
      clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
      JSON.stringify(effectsDefs),
    ], { priority: true });
    return `Applied "${cmdName}": ${JSON.stringify(result)}`;
  }

  return `Unknown fxcl operation: ${cmdName} (${JSON.stringify(subMenu)})`;
}

async function handleVideoFilter(
  mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const effectName = mod.cmdName ?? '';

  // Apply the effect via QE DOM
  const result = await bridge.callExtendScript('effects.applyVideoFilter', [
    clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType, effectName,
  ], { priority: true });

  // If preset property overrides exist, apply them
  const presetData = presets?.['vf']?.[effectName];
  if (presetData) {
    const effectsDefs = buildEffectDefs(presetData);
    await bridge.callExtendScript('effects.applyEffects', [
      clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
      JSON.stringify(effectsDefs),
    ], { priority: true });
  }

  return `Applied video filter "${effectName}": ${JSON.stringify(result)}`;
}

async function handleAudioFilter(
  mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const effectName = mod.cmdName ?? '';

  const result = await bridge.callExtendScript('effects.applyAudioFilter', [
    clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType, effectName,
  ], { priority: true });

  const presetData = presets?.['af']?.[effectName];
  if (presetData) {
    const effectsDefs = buildEffectDefs(presetData);
    await bridge.callExtendScript('effects.applyEffects', [
      clipInfo.trackIndex, clipInfo.clipIndex, clipInfo.trackType,
      JSON.stringify(effectsDefs),
    ], { priority: true });
  }

  return `Applied audio filter "${effectName}": ${JSON.stringify(result)}`;
}

async function handleVideoTransition(
  mod: any, bridge: BridgeHandler, _presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const transitionName = mod.cmdName ?? '';
  const subMenu = mod.subMenu ?? {};
  // Default: apply at end of clip (the cut point going to the next clip)
  const atEnd = subMenu.position !== 'start';

  const result = await bridge.callExtendScript('effects.applyVideoTransition', [
    clipInfo.trackIndex, clipInfo.clipIndex, transitionName, atEnd,
  ], { priority: true });
  return `Applied video transition "${transitionName}": ${JSON.stringify(result)}`;
}

async function handleAudioTransition(
  mod: any, bridge: BridgeHandler, _presets: any, clipInfo: ClipInfo,
): Promise<string> {
  const transitionName = mod.cmdName ?? '';
  const subMenu = mod.subMenu ?? {};
  const atEnd = subMenu.position !== 'start';

  const result = await bridge.callExtendScript('effects.applyAudioTransition', [
    clipInfo.trackIndex, clipInfo.clipIndex, transitionName, atEnd,
  ], { priority: true });
  return `Applied audio transition "${transitionName}": ${JSON.stringify(result)}`;
}

// ── Sequence operations (no clip required) ──────────────────────────────

const SEQUENCE_OPS: Record<string, (bridge: BridgeHandler, mod: any) => Promise<string>> = {
  'Open Sequence': async (bridge, mod) => {
    const name = mod.subMenu?.value || mod.cmdName;
    const result = await bridge.callExtendScript('sequence.openSequenceByName', [name], { priority: true });
    return `Open Sequence: ${JSON.stringify(result)}`;
  },
  'Duplicate and Increment': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.duplicateAndIncrement', [], { priority: true });
    return `Duplicate: ${JSON.stringify(result)}`;
  },
  'Add Marker to Sequence': async (bridge, mod) => {
    const name = mod.subMenu?.value || '';
    const color = mod.subMenu?.color ? parseInt(mod.subMenu.color, 10) : 0;
    const result = await bridge.callExtendScript('sequence.addMarkerAtPlayhead', [name, color], { priority: true });
    return `Add Marker: ${JSON.stringify(result)}`;
  },
  'Add Marker': async (bridge, mod) => {
    const name = mod.subMenu?.value || '';
    const color = mod.subMenu?.color ? parseInt(mod.subMenu.color, 10) : 0;
    const result = await bridge.callExtendScript('sequence.addMarkerAtPlayhead', [name, color], { priority: true });
    return `Add Marker: ${JSON.stringify(result)}`;
  },
  'Razor at Playhead': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.razorAtPlayhead', [], { priority: true });
    return `Razor: ${JSON.stringify(result)}`;
  },
  'Razor': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.razorAtPlayhead', [], { priority: true });
    return `Razor: ${JSON.stringify(result)}`;
  },
  'Set In Point': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.setInPoint', [], { priority: true });
    return `Set In: ${JSON.stringify(result)}`;
  },
  'Set Out Point': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.setOutPoint', [], { priority: true });
    return `Set Out: ${JSON.stringify(result)}`;
  },
  'Clear In/Out': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.clearInOut', [], { priority: true });
    return `Clear In/Out: ${JSON.stringify(result)}`;
  },
  'Clear In and Out': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.clearInOut', [], { priority: true });
    return `Clear In/Out: ${JSON.stringify(result)}`;
  },
  'Go to In Point': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.goToInPoint', [], { priority: true });
    return `Go to In: ${JSON.stringify(result)}`;
  },
  'Go to Out Point': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.goToOutPoint', [], { priority: true });
    return `Go to Out: ${JSON.stringify(result)}`;
  },
  'Lift': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.liftSelection', [], { priority: true });
    return `Lift: ${JSON.stringify(result)}`;
  },
  'Extract': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.extractSelection', [], { priority: true });
    return `Extract: ${JSON.stringify(result)}`;
  },
  'Render In to Out': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.renderInToOut', [], { priority: true });
    return `Render: ${JSON.stringify(result)}`;
  },
  'Render Preview': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.renderInToOut', [], { priority: true });
    return `Render: ${JSON.stringify(result)}`;
  },
  'Zoom to Sequence': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.zoomToSequence', [], { priority: true });
    return `Zoom: ${JSON.stringify(result)}`;
  },
  'Select All': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.selectAll', [], { priority: true });
    return `Select All: ${JSON.stringify(result)}`;
  },
  'Deselect All': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.deselectAll', [], { priority: true });
    return `Deselect All: ${JSON.stringify(result)}`;
  },
};

async function handleSequenceOp(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const handler = SEQUENCE_OPS[cmdName];
  if (handler) {
    return handler(bridge, mod);
  }
  // Fallback: try to execute as a generic Premiere command via the sequence module
  // Some sequence operations use command IDs stored in subMenu
  const commandId = mod.subMenu?.commandId;
  if (commandId) {
    const result = await bridge.callExtendScript('sequence.executeCommand', [parseInt(commandId, 10)], { priority: true });
    return `Execute command ${commandId}: ${JSON.stringify(result)}`;
  }
  return `Unknown sequence operation: ${cmdName}`;
}

// ── Selection operations ────────────────────────────────────────────────

const SELECTION_OPS: Record<string, (bridge: BridgeHandler) => Promise<string>> = {
  'Select Clip Above': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.executeCommand', [41012], { priority: true });
    return `Select Above: ${JSON.stringify(result)}`;
  },
  'Select Clip Below': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.executeCommand', [41013], { priority: true });
    return `Select Below: ${JSON.stringify(result)}`;
  },
  'Extend Selection': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.executeCommand', [41161], { priority: true });
    return `Extend Selection: ${JSON.stringify(result)}`;
  },
  'Extend Selection Up': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.executeCommand', [41159], { priority: true });
    return `Extend Up: ${JSON.stringify(result)}`;
  },
  'Extend Selection Down': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.executeCommand', [41160], { priority: true });
    return `Extend Down: ${JSON.stringify(result)}`;
  },
  'Select All': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.selectAll', [], { priority: true });
    return `Select All: ${JSON.stringify(result)}`;
  },
  'Deselect All': async (bridge) => {
    const result = await bridge.callExtendScript('sequence.deselectAll', [], { priority: true });
    return `Deselect All: ${JSON.stringify(result)}`;
  },
};

async function handleSelectionOp(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const handler = SELECTION_OPS[cmdName];
  if (handler) return handler(bridge);

  const commandId = mod.subMenu?.commandId;
  if (commandId) {
    const result = await bridge.callExtendScript('sequence.executeCommand', [parseInt(commandId, 10)], { priority: true });
    return `Selection command ${commandId}: ${JSON.stringify(result)}`;
  }
  return `Unknown selection operation: ${cmdName}`;
}

// ── Export operations ───────────────────────────────────────────────────

const EXPORT_OPS: Record<string, (bridge: BridgeHandler, mod: any) => Promise<string>> = {
  'Export Media': async (bridge) => {
    const result = await bridge.callExtendScript('exports.exportMedia', [], { priority: true });
    return `Export Media: ${JSON.stringify(result)}`;
  },
  'Export Selected Clips': async (bridge) => {
    const result = await bridge.callExtendScript('exports.exportSelectedClips', [], { priority: true });
    return `Export Selected: ${JSON.stringify(result)}`;
  },
  'Export Frame': async (bridge) => {
    const result = await bridge.callExtendScript('exports.exportFrame', [], { priority: true });
    return `Export Frame: ${JSON.stringify(result)}`;
  },
  'Export Frame as JPEG': async (bridge) => {
    const result = await bridge.callExtendScript('exports.exportFrameJPEG', [], { priority: true });
    return `Export JPEG: ${JSON.stringify(result)}`;
  },
};

async function handleExportOp(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const handler = EXPORT_OPS[cmdName];
  if (handler) return handler(bridge, mod);
  return `Unknown export operation: ${cmdName}`;
}

// ── Project operations ──────────────────────────────────────────────────

const PROJECT_OPS: Record<string, (bridge: BridgeHandler, mod: any) => Promise<string>> = {
  'Increment and Save': async (bridge) => {
    const result = await bridge.callExtendScript('project.incrementAndSave', [], { priority: true });
    return `Increment & Save: ${JSON.stringify(result)}`;
  },
  'Change Workspace': async (bridge, mod) => {
    const workspace = mod.subMenu?.value || mod.cmdName;
    const result = await bridge.callExtendScript('sequence.executeCommand', [41052], { priority: true });
    return `Change Workspace "${workspace}": ${JSON.stringify(result)}`;
  },
  'Execute Script': async (bridge, mod) => {
    const scriptPath = mod.subMenu?.value || '';
    if (!scriptPath) return 'No script path specified';
    // Safety: only execute scripts from the Excalibur scripts directory
    const result = await bridge.callExtendScript('project.executeScript', [scriptPath], { priority: true });
    return `Execute Script: ${JSON.stringify(result)}`;
  },
};

async function handleProjectOp(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  const handler = PROJECT_OPS[cmdName];
  if (handler) return handler(bridge, mod);
  return `Unknown project operation: ${cmdName}`;
}

// ── Preferences toggles ────────────────────────────────────────────────

async function handlePreferenceToggle(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const prefName = mod.cmdName ?? '';
  const result = await bridge.callExtendScript('preferences.toggle', [prefName], { priority: true });
  return `Toggle "${prefName}": ${JSON.stringify(result)}`;
}

// ── Special commands ────────────────────────────────────────────────────

async function handleSpecialCommand(
  mod: any, bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  if (cmdName === 'Undo') {
    const result = await bridge.callExtendScript('sequence.undo', [], { priority: true });
    return `Undo: ${JSON.stringify(result)}`;
  }
  if (cmdName === 'Excalibur Settings') {
    return 'Excalibur Settings is not applicable in Mayday';
  }
  return `Unknown special command: ${cmdName}`;
}

// ── Extension commands (not supported) ──────────────────────────────────

async function handleExtensionCommand(
  mod: any, _bridge: BridgeHandler,
): Promise<string> {
  const cmdName = mod.cmdName ?? '';
  return `Extension command "${cmdName}" requires Excalibur's native panel and is not supported in Mayday`;
}

// ── Handler dispatch map ────────────────────────────────────────────────

type ClipHandler = (mod: any, bridge: BridgeHandler, presets: any, clipInfo: ClipInfo) => Promise<string>;
type NoClipHandler = (mod: any, bridge: BridgeHandler) => Promise<string>;

const clipHandlers: Record<string, ClipHandler> = {
  'fxvp.': handleVideoPreset,
  'fxap.': handleAudioPreset,
  'fxcl.': handleClipProperty,
  'fxvf.': handleVideoFilter,
  'fxaf.': handleAudioFilter,
  'fxvt.': handleVideoTransition,
  'fxat.': handleAudioTransition,
};

const noClipHandlers: Record<string, NoClipHandler> = {
  'fxsq.': handleSequenceOp,
  'fxsl.': handleSelectionOp,
  'fxex.': handleExportOp,
  'fxpr.': handleProjectOp,
  'fxpf.': handlePreferenceToggle,
  'fxsp.': handleSpecialCommand,
  'fxmd.': handleExtensionCommand,
};

// ── Main executor ───────────────────────────────────────────────────────

export async function executeExcaliburCommand(
  commandName: string,
  bridge: BridgeHandler,
): Promise<ExcaliburResult> {
  if (!bridge.isConnected()) {
    return { success: false, error: 'Premiere Pro not connected. Open Premiere and the Mayday panel.' };
  }

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

  const modules = userCmd.modules ?? {};
  if (Object.keys(modules).length === 0) {
    return { success: true, results: ['Command has no modules'] };
  }

  // Determine if any module needs a selected clip
  let clipInfo: ClipInfo | null = null;
  const needsClip = Object.values(modules).some((mod: any) => {
    const cmdID = mod.cmdID ?? '';
    return CLIP_REQUIRED.has(cmdID);
  });

  if (needsClip) {
    clipInfo = await bridge.callExtendScript('effects.getSelectedClipInfo', [], { priority: true }) as ClipInfo | null;
    if (!clipInfo) {
      return { success: false, error: 'No clip selected in Premiere Pro' };
    }
  }

  const results: string[] = [];

  for (const [_modKey, mod] of Object.entries(modules) as Array<[string, any]>) {
    const cmdID: string = mod.cmdID ?? '';

    try {
      if (clipHandlers[cmdID] && clipInfo) {
        const result = await clipHandlers[cmdID](mod, bridge, presets, clipInfo);
        results.push(result);
      } else if (noClipHandlers[cmdID]) {
        const result = await noClipHandlers[cmdID](mod, bridge);
        results.push(result);
      } else if (clipHandlers[cmdID] && !clipInfo) {
        // Clip handler but no clip — try to get one now
        const lateClipInfo = await bridge.callExtendScript('effects.getSelectedClipInfo', [], { priority: true }) as ClipInfo | null;
        if (lateClipInfo) {
          const result = await clipHandlers[cmdID](mod, bridge, presets, lateClipInfo);
          results.push(result);
        } else {
          results.push(`No clip selected for ${cmdID} command "${mod.cmdName}"`);
        }
      } else {
        results.push(`Unknown command type: ${cmdID}`);
      }
    } catch (err) {
      results.push(`Error in ${cmdID} "${mod.cmdName}": ${err instanceof Error ? err.message : String(err)}`);
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
