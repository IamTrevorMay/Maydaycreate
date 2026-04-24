#!/usr/bin/env node

/**
 * Excalibur Command Audit Script
 *
 * Iterates every command in Excalibur's .cmdlist.json and validates that
 * each one is correctly translated and applied in Premiere Pro.
 *
 * Prerequisites:
 *   1. Mayday server running (npm run dev:launcher)
 *   2. Premiere Pro open with the Mayday CEP panel connected
 *   3. A clip selected on the timeline (video clip on V1 recommended)
 *
 * Usage:
 *   node tools/audit-excalibur.mjs [--execute] [--command "Command Name"]
 *
 * Flags:
 *   --execute     Actually run the commands (default: dry-run analysis only)
 *   --command     Run audit for a single command by name
 *   --port        Server port (default: 9876)
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const PORT = args.includes('--port') ? args[args.indexOf('--port') + 1] : '9876';
const SINGLE_CMD = args.includes('--command') ? args[args.indexOf('--command') + 1] : null;
const BASE_URL = `http://localhost:${PORT}`;

const EXCALIBUR_DIR = path.join(
  os.homedir(), 'Library', 'Application Support',
  'Knights of the Editing Table', 'excalibur',
);

// ── Helpers ─────────────────────────────────────────────────────────────────

async function api(method, endpoint, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${endpoint}`, opts);
  return res.json();
}

function fmt(val) {
  if (val === null || val === undefined) return 'null';
  if (Array.isArray(val)) return `[${val.map(v => typeof v === 'number' ? v.toFixed(4) : v).join(', ')}]`;
  if (typeof val === 'number') return val.toFixed(4);
  return String(val);
}

// Known property expectations for Motion intrinsic defaults (1080p sequence)
const MOTION_DEFAULTS = {
  'Position': { type: '2D point', notes: 'Normalized 0-1; center = [0.5, 0.5]' },
  'Scale': { type: 'float', notes: 'Percentage; 100 = native size' },
  'Scale Width': { type: 'float', notes: 'Percentage; only active if Uniform Scale is off' },
  'Rotation': { type: 'angle', notes: 'Degrees' },
  'Anchor Point': { type: '2D point', notes: 'Normalized 0-1; center = [0.5, 0.5]' },
  'Anti-flicker Filter': { type: 'float', notes: '0-1 range' },
  'Opacity': { type: 'float', notes: '0-100 percentage' },
};

// ── Analysis ────────────────────────────────────────────────────────────────

function analyzeCommand(name, cmd, presets) {
  const modules = cmd.modules ?? {};
  const analysis = {
    name,
    modules: [],
    warnings: [],
  };

  for (const [modKey, mod] of Object.entries(modules)) {
    const cmdID = mod.cmdID ?? '';
    const cmdName = mod.cmdName ?? '';
    const subMenu = mod.subMenu ?? {};
    const modAnalysis = { modKey, cmdID, cmdName, subMenu: subMenu.selected, issues: [] };

    if (cmdID === 'fxvp.' || cmdID === 'fxap.') {
      // Preset application — check preset exists
      const presetCategory = cmdID === 'fxvp.' ? 'vp' : 'ap';
      const presetData = presets?.[presetCategory]?.[cmdName];
      if (!presetData) {
        modAnalysis.issues.push(`MISSING PRESET: "${cmdName}" not found in ${presetCategory}`);
      } else {
        const effects = Array.isArray(presetData) ? presetData : [presetData];
        modAnalysis.effectCount = effects.length;
        modAnalysis.properties = [];

        for (const effect of effects) {
          const props = effect.props ?? [];
          for (const p of props) {
            if (!p.Name) continue;
            const pct = p.ParameterControlType ?? -1;
            const entry = { name: p.Name, pct, matchName: p.matchName ?? '' };

            // Check for potentially problematic types
            if (pct === 6) {
              // 2D point from preset — should be normalized (0-1)
              const sk = typeof p.StartKeyframe === 'string' ? p.StartKeyframe : null;
              if (sk) {
                const parts = sk.split(',');
                if (parts.length >= 2 && parts[1].includes(':')) {
                  const [xStr, yStr] = parts[1].split(':');
                  const x = parseFloat(xStr);
                  const y = parseFloat(yStr);
                  entry.rawValue = `${x}:${y}`;
                  if (x > 1 || y > 1) {
                    modAnalysis.issues.push(
                      `2D POINT "${p.Name}": raw value [${x}, ${y}] is > 1 — may be pixel coords treated as normalized`
                    );
                  }
                }
              }
            }

            if (pct === 5) {
              // Color — check decoding
              const sk = typeof p.StartKeyframe === 'string' ? p.StartKeyframe : null;
              if (sk) {
                const parts = sk.split(',');
                if (parts.length >= 2) {
                  try {
                    const big = BigInt(parts[1]);
                    const a = Number((big >> 56n) & 0xFFn);
                    const r = Number((big >> 40n) & 0xFFn);
                    const g = Number((big >> 24n) & 0xFFn);
                    const b = Number((big >> 8n) & 0xFFn);
                    entry.decodedColor = { a, r, g, b };
                    if (a > 255 || r > 255 || g > 255 || b > 255) {
                      modAnalysis.issues.push(`COLOR "${p.Name}": decoded ARGB out of range`);
                    }
                  } catch {
                    modAnalysis.issues.push(`COLOR "${p.Name}": failed to decode packed int64`);
                  }
                }
              }
            }

            modAnalysis.properties.push(entry);
          }
        }
      }

    } else if (cmdID === 'fxcl.') {
      if (subMenu.selected === 'set' || subMenu.selected === 'calc') {
        modAnalysis.value = subMenu.value ?? null;
        modAnalysis.valueX = subMenu.valuex ?? null;
        modAnalysis.valueY = subMenu.valuey ?? null;

        // Check Position specifically
        if (cmdName === 'Position' && subMenu.valuex != null && subMenu.valuey != null) {
          const x = parseFloat(subMenu.valuex);
          const y = parseFloat(subMenu.valuey);
          modAnalysis.pixelValues = [x, y];
          modAnalysis.notes = `Will be normalized to [${(x / 3840).toFixed(4)}, ${(y / 2160).toFixed(4)}] for 4K or [${(x / 1920).toFixed(4)}, ${(y / 1080).toFixed(4)}] for 1080p`;

          // Sanity check: are these reasonable pixel values?
          if (x > 7680 || y > 4320) {
            modAnalysis.issues.push(`Position [${x}, ${y}] seems too large — are these really pixel coordinates?`);
          }
        }

        // Check Scale
        if (cmdName === 'Scale' && subMenu.value != null) {
          const v = parseFloat(subMenu.value);
          if (v > 1000) {
            modAnalysis.issues.push(`Scale ${v}% seems unusually large`);
          }
        }

      } else if (subMenu.selected === 'native') {
        modAnalysis.notes = `Native Premiere command: ${cmdName}`;
      } else if (subMenu.selected === 'atclips') {
        const presetData = presets?.['ap']?.[cmdName] ?? presets?.['vp']?.[cmdName];
        if (!presetData) {
          modAnalysis.issues.push(`MISSING PRESET for atclips: "${cmdName}"`);
        }
      } else {
        modAnalysis.issues.push(`Unknown subMenu.selected: "${subMenu.selected}"`);
      }

    } else {
      modAnalysis.issues.push(`Unknown cmdID: "${cmdID}"`);
    }

    analysis.modules.push(modAnalysis);
    if (modAnalysis.issues.length > 0) {
      analysis.warnings.push(...modAnalysis.issues);
    }
  }

  return analysis;
}

// ── Execution test ──────────────────────────────────────────────────────────

async function testCommand(name) {
  console.log(`\n  Capturing clip state BEFORE...`);
  const before = await api('GET', '/api/clip/properties');
  if (!before.success) {
    console.log(`  ERROR: ${before.error}`);
    return null;
  }

  console.log(`  Executing "${name}"...`);
  const result = await api('POST', '/api/excalibur/execute', { commandName: name });
  if (!result.success) {
    console.log(`  EXECUTE FAILED: ${result.error}`);
    return { before: before.capture, error: result.error };
  }

  // Small delay for Premiere to process
  await new Promise(r => setTimeout(r, 500));

  console.log(`  Capturing clip state AFTER...`);
  const after = await api('GET', '/api/clip/properties');
  if (!after.success) {
    console.log(`  ERROR reading after state: ${after.error}`);
    return { before: before.capture, result, afterError: after.error };
  }

  return { before: before.capture, after: after.capture, result };
}

function diffProperties(before, after, cmdName) {
  const diffs = [];

  // Build property maps for ALL components (Motion, Opacity, Volume, etc.)
  const buildPropMap = (capture) => {
    const map = {};
    if (!capture?.effects) return map;
    for (const e of capture.effects) {
      for (const p of e.properties) {
        const key = `${e.displayName} > ${p.displayName}`;
        map[key] = p.value;
      }
    }
    return map;
  };

  const beforeProps = buildPropMap(before);
  const afterProps = buildPropMap(after);

  // Check for changed properties
  for (const [key, afterVal] of Object.entries(afterProps)) {
    const beforeVal = beforeProps[key];
    const changed = JSON.stringify(beforeVal) !== JSON.stringify(afterVal);
    if (changed) {
      diffs.push({
        property: key,
        before: beforeVal,
        after: afterVal,
      });
    }
  }

  // Check for new properties (effects added)
  for (const [key, afterVal] of Object.entries(afterProps)) {
    if (!(key in beforeProps)) {
      diffs.push({
        property: key + ' (NEW)',
        before: undefined,
        after: afterVal,
      });
    }
  }

  return diffs;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Excalibur Command Audit');
  console.log(`  Mode: ${EXECUTE ? 'EXECUTE (will modify clip!)' : 'DRY-RUN (analysis only)'}`);
  console.log('═══════════════════════════════════════════════════════════\n');

  // Load Excalibur data
  const cmdlistPath = path.join(EXCALIBUR_DIR, '.cmdlist.json');
  const presetPath = path.join(EXCALIBUR_DIR, '.presetaction.json');

  if (!fs.existsSync(cmdlistPath)) {
    console.error('ERROR: .cmdlist.json not found at', cmdlistPath);
    process.exit(1);
  }

  const cmdlist = JSON.parse(fs.readFileSync(cmdlistPath, 'utf-8'));
  const presets = fs.existsSync(presetPath)
    ? JSON.parse(fs.readFileSync(presetPath, 'utf-8'))
    : {};

  const userCmds = cmdlist['us'] ?? {};
  const cmdNames = SINGLE_CMD ? [SINGLE_CMD] : Object.keys(userCmds);

  // Check server connectivity
  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch {
    console.error('ERROR: Cannot reach Mayday server at', BASE_URL);
    console.error('Make sure the dev launcher is running.');
    process.exit(1);
  }

  // Check Premiere connection
  if (EXECUTE) {
    const clipCheck = await api('GET', '/api/clip/properties');
    if (!clipCheck.success) {
      console.error('ERROR:', clipCheck.error);
      console.error('Make sure Premiere is open, CEP panel is connected, and a clip is selected.');
      process.exit(1);
    }
    console.log(`Connected to Premiere. Selected clip: "${clipCheck.capture.clipName}"\n`);
  }

  // ── Phase 1: Static Analysis ────────────────────────────────────────────

  console.log('─── Phase 1: Static Analysis ───────────────────────────────\n');

  const analyses = [];
  let totalWarnings = 0;

  for (const name of cmdNames) {
    const cmd = userCmds[name];
    if (!cmd) {
      console.log(`  SKIP: "${name}" not found in cmdlist`);
      continue;
    }
    if (cmd.show !== 1) {
      console.log(`  SKIP: "${name}" (hidden)`);
      continue;
    }

    const analysis = analyzeCommand(name, cmd, presets);
    analyses.push(analysis);

    const status = analysis.warnings.length > 0 ? '⚠' : '✓';
    console.log(`  ${status} ${name}`);

    for (const mod of analysis.modules) {
      const typeLabel = mod.cmdID === 'fxvp.' ? 'Video Preset'
        : mod.cmdID === 'fxap.' ? 'Audio Preset'
        : mod.subMenu === 'set' ? 'Set Property'
        : mod.subMenu === 'calc' ? 'Calc Property'
        : mod.subMenu === 'native' ? 'Native Command'
        : mod.subMenu === 'atclips' ? 'Apply to Clips'
        : 'Unknown';

      console.log(`    ${mod.modKey}: [${typeLabel}] ${mod.cmdName}`);

      if (mod.value != null) console.log(`      value: ${mod.value}`);
      if (mod.valueX != null) console.log(`      valueX: ${mod.valueX}, valueY: ${mod.valueY}`);
      if (mod.notes) console.log(`      note: ${mod.notes}`);
      if (mod.effectCount) console.log(`      effects: ${mod.effectCount}`);
      if (mod.properties) {
        for (const p of mod.properties) {
          let detail = `PCT=${p.pct}`;
          if (p.rawValue) detail += ` raw=${p.rawValue}`;
          if (p.decodedColor) detail += ` color=rgba(${p.decodedColor.r},${p.decodedColor.g},${p.decodedColor.b},${p.decodedColor.a})`;
          console.log(`      - ${p.name} (${detail})`);
        }
      }

      for (const issue of mod.issues) {
        console.log(`      *** ${issue}`);
        totalWarnings++;
      }
    }
  }

  console.log(`\n  Static analysis complete: ${analyses.length} commands, ${totalWarnings} warning(s)\n`);

  // ── Phase 2: Execution Test ─────────────────────────────────────────────

  if (!EXECUTE) {
    console.log('─── Phase 2: Skipped (use --execute to run commands) ───────\n');
    console.log('  To run the full audit with execution:');
    console.log('  node tools/audit-excalibur.mjs --execute\n');
    console.log('  To test a single command:');
    console.log('  node tools/audit-excalibur.mjs --execute --command "Revert to Default"\n');
    return;
  }

  console.log('─── Phase 2: Execution Test ─────────────────────────────────\n');

  const results = [];

  for (const analysis of analyses) {
    console.log(`\n● ${analysis.name}`);
    const testResult = await testCommand(analysis.name);

    if (testResult && testResult.before && testResult.after) {
      const diffs = diffProperties(testResult.before, testResult.after, analysis.name);
      if (diffs.length > 0) {
        console.log(`  Changes detected:`);
        for (const d of diffs) {
          console.log(`    ${d.property}: ${fmt(d.before)} → ${fmt(d.after)}`);

          // Validate specific properties
          for (const mod of analysis.modules) {
            // Property key now includes component: "Motion > Position"
            const propInKey = d.property.includes(mod.cmdName);
            if (propInKey) {
              if (mod.cmdName === 'Position' && mod.pixelValues) {
                const afterArr = d.after;
                if (Array.isArray(afterArr)) {
                  if (afterArr[0] > 10000 || afterArr[1] > 10000) {
                    console.log(`    *** BUG: Position value [${afterArr}] is way too large — normalization likely broken`);
                  }
                  if (afterArr[0] > 1.5 || afterArr[1] > 1.5) {
                    console.log(`    *** WARNING: Position [${afterArr.map(v=>v.toFixed(4))}] > 1.0 — command may have been authored for a larger sequence`);
                  }
                }
              }
              if (mod.cmdName === 'Scale' && mod.value != null) {
                const expected = parseFloat(mod.value);
                const actual = d.after;
                if (typeof actual === 'number' && Math.abs(actual - expected) > 0.01) {
                  console.log(`    *** MISMATCH: Expected Scale=${expected}, got ${actual}`);
                }
              }
            }
          }
        }
      } else {
        console.log(`  No property changes detected on this clip`);
      }

      results.push({ name: analysis.name, diffs, ok: true });
    } else if (testResult?.error) {
      results.push({ name: analysis.name, error: testResult.error, ok: false });
    }

    // Brief pause between commands
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('  AUDIT SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.ok);
  const failed = results.filter(r => !r.ok);

  console.log(`  Total commands: ${results.length}`);
  console.log(`  Executed OK:    ${passed.length}`);
  console.log(`  Failed:         ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n  Failed commands:');
    for (const f of failed) {
      console.log(`    - ${f.name}: ${f.error}`);
    }
  }

  if (totalWarnings > 0) {
    console.log(`\n  Static analysis warnings: ${totalWarnings}`);
    for (const a of analyses) {
      for (const w of a.warnings) {
        console.log(`    - [${a.name}] ${w}`);
      }
    }
  }

  console.log('');
}

main().catch(err => {
  console.error('Audit failed:', err.message);
  process.exit(1);
});
