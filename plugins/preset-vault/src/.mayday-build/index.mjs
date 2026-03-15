// ../sdk/dist/index.js
function definePlugin(definition) {
  if (typeof definition.activate !== "function") {
    throw new Error("Plugin must define an activate() function");
  }
  if (definition.commands) {
    for (const [id, handler] of Object.entries(definition.commands)) {
      if (typeof handler !== "function") {
        throw new Error(`Command "${id}" must be a function`);
      }
    }
  }
  return definition;
}

// ../../plugins/preset-vault/src/index.ts
import { randomUUID } from "crypto";

// ../../plugins/preset-vault/src/storage.ts
import fs from "fs";
import path from "path";
var INDEX_FILE = "index.json";
var PRESETS_DIR = "presets";
function ensureDirs(baseDir) {
  const presetsDir = path.join(baseDir, PRESETS_DIR);
  if (!fs.existsSync(presetsDir)) {
    fs.mkdirSync(presetsDir, { recursive: true });
  }
}
function emptyIndex() {
  return { version: 1, presets: [], folders: [], lastUpdated: (/* @__PURE__ */ new Date()).toISOString() };
}
function loadIndex(baseDir) {
  const indexPath = path.join(baseDir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) return emptyIndex();
  try {
    return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
  } catch {
    return emptyIndex();
  }
}
function saveIndex(baseDir, index) {
  index.lastUpdated = (/* @__PURE__ */ new Date()).toISOString();
  fs.writeFileSync(path.join(baseDir, INDEX_FILE), JSON.stringify(index, null, 2));
}
function buildFolders(presets) {
  const folderMap = /* @__PURE__ */ new Map();
  for (const p of presets) {
    const folderPath = p.folder || "";
    if (!folderPath) continue;
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, {
        name: folderPath.split("/").pop() || folderPath,
        path: folderPath,
        children: [],
        presetCount: 0
      });
    }
    folderMap.get(folderPath).presetCount++;
  }
  return Array.from(folderMap.values());
}
function savePreset(baseDir, preset) {
  ensureDirs(baseDir);
  const presetPath = path.join(baseDir, PRESETS_DIR, `${preset.id}.json`);
  fs.writeFileSync(presetPath, JSON.stringify(preset, null, 2));
  const index = loadIndex(baseDir);
  const entry = {
    id: preset.id,
    name: preset.name,
    tags: preset.tags,
    folder: preset.folder,
    effectCount: preset.effects.filter((e) => !e.isIntrinsic || preset.includeIntrinsics).length,
    sourceClipName: preset.sourceClipName,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt
  };
  const existingIdx = index.presets.findIndex((p) => p.id === preset.id);
  if (existingIdx >= 0) {
    index.presets[existingIdx] = entry;
  } else {
    index.presets.push(entry);
  }
  index.folders = buildFolders(index.presets);
  saveIndex(baseDir, index);
  return entry;
}
function loadPreset(baseDir, presetId) {
  const presetPath = path.join(baseDir, PRESETS_DIR, `${presetId}.json`);
  if (!fs.existsSync(presetPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(presetPath, "utf-8"));
  } catch {
    return null;
  }
}
function deletePreset(baseDir, presetId) {
  const presetPath = path.join(baseDir, PRESETS_DIR, `${presetId}.json`);
  if (!fs.existsSync(presetPath)) return false;
  fs.unlinkSync(presetPath);
  const index = loadIndex(baseDir);
  index.presets = index.presets.filter((p) => p.id !== presetId);
  index.folders = buildFolders(index.presets);
  saveIndex(baseDir, index);
  return true;
}
function listPresets(baseDir, filter) {
  const index = loadIndex(baseDir);
  let results = index.presets;
  if (filter?.folder) {
    results = results.filter((p) => p.folder === filter.folder || p.folder.startsWith(filter.folder + "/"));
  }
  if (filter?.tag) {
    const tag = filter.tag.toLowerCase();
    results = results.filter((p) => p.tags.some((t) => t.toLowerCase() === tag));
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    results = results.filter(
      (p) => p.name.toLowerCase().includes(q) || p.sourceClipName.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }
  return results;
}

// ../../plugins/preset-vault/src/excalibur.ts
var DEFAULT_PORT = 9876;
function curlCommand(presetId, port = DEFAULT_PORT) {
  return `curl -s -X POST http://localhost:${port}/api/plugins/preset-vault/command/apply -H "Content-Type: application/json" -d "{\\"presetId\\":\\"${presetId}\\"}"`;
}
function buildExcaliburCommands(presets, port = DEFAULT_PORT) {
  return presets.map((p) => ({
    presetId: p.id,
    presetName: p.name,
    curlCommand: curlCommand(p.id, port),
    description: `Apply "${p.name}" (${p.effectCount} effects) from ${p.sourceClipName}`
  }));
}
function generateExcaliburGuide(presets, port = DEFAULT_PORT) {
  const commands = buildExcaliburCommands(presets, port);
  let md = `# Excalibur User Commands \u2014 Preset Vault

`;
  md += `These presets can be applied via Excalibur User Commands.
`;
  md += `For each preset below, create a new User Command in Excalibur:

`;
  md += `## Setup

`;
  md += `1. Open Excalibur \u2192 Settings \u2192 User Commands
`;
  md += `2. Click "Add Command"
`;
  md += `3. Set Type to "Shell / Script"
`;
  md += `4. Paste the command below
`;
  md += `5. Assign a keyboard shortcut

`;
  md += `## Presets

`;
  for (const cmd of commands) {
    md += `### ${cmd.presetName}
`;
    md += `${cmd.description}

`;
    md += `\`\`\`
${cmd.curlCommand}
\`\`\`

`;
  }
  return md;
}
function generateAHKScript(presets, port = DEFAULT_PORT) {
  const commands = buildExcaliburCommands(presets, port);
  let script = `; Preset Vault \u2014 AutoHotkey Script
`;
  script += `; Generated by Mayday Create
`;
  script += `; Assign F-keys to presets

`;
  script += `#Requires AutoHotkey v2.0

`;
  const fKeys = ["F13", "F14", "F15", "F16", "F17", "F18", "F19", "F20", "F21", "F22", "F23", "F24"];
  for (let i = 0; i < commands.length && i < fKeys.length; i++) {
    const cmd = commands[i];
    script += `; ${cmd.presetName} \u2014 ${cmd.description}
`;
    script += `${fKeys[i]}::
`;
    script += `{
`;
    script += `    Run '${cmd.curlCommand.replace(/'/g, "''")}', , "Hide"
`;
    script += `}

`;
  }
  return script;
}
function generateKeyboardMaestro(presets, port = DEFAULT_PORT) {
  const commands = buildExcaliburCommands(presets, port);
  let doc = `# Preset Vault \u2014 Keyboard Maestro Macros

`;
  doc += `Create a new macro for each preset below.

`;
  for (const cmd of commands) {
    doc += `## ${cmd.presetName}
`;
    doc += `${cmd.description}

`;
    doc += `**Action:** Execute Shell Script
`;
    doc += `\`\`\`bash
${cmd.curlCommand}
\`\`\`

`;
    doc += `**Trigger:** Assign your preferred hotkey

---

`;
  }
  return doc;
}

// ../../plugins/preset-vault/src/index.ts
function storageDir(ctx) {
  return ctx.dataDir;
}
var src_default = definePlugin({
  async activate(ctx) {
    const fs2 = await import("fs");
    const path2 = await import("path");
    const presetsDir = path2.join(storageDir(ctx), "presets");
    if (!fs2.existsSync(presetsDir)) {
      fs2.mkdirSync(presetsDir, { recursive: true });
    }
    ctx.log.info("Preset Vault activated");
  },
  commands: {
    async capture(ctx, args) {
      const opts = args ?? {};
      if (!opts.name) throw new Error("Preset name is required");
      const captureResult = await ctx.services.effects.captureFromSelected();
      if (!captureResult) throw new Error("No clip selected or capture failed");
      const includeIntrinsics = opts.includeIntrinsics ?? false;
      let effects = captureResult.effects;
      if (!includeIntrinsics) {
        effects = effects.filter((e) => !e.isIntrinsic);
      }
      if (effects.length === 0) {
        throw new Error("No effects found on selected clip");
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const preset = {
        id: randomUUID(),
        name: opts.name,
        version: 1,
        tags: opts.tags ?? [],
        folder: opts.folder ?? "",
        description: opts.description ?? "",
        sourceClipName: captureResult.clipName,
        includeIntrinsics,
        createdAt: now,
        updatedAt: now,
        effects
      };
      const entry = savePreset(storageDir(ctx), preset);
      ctx.ui.showToast(`Captured "${preset.name}" (${entry.effectCount} effects)`, "success");
      ctx.ui.pushToPanel("preset-saved", entry);
      return entry;
    },
    async apply(ctx, args) {
      const opts = args ?? {};
      if (!opts.presetId) throw new Error("presetId is required");
      const preset = loadPreset(storageDir(ctx), opts.presetId);
      if (!preset) throw new Error(`Preset not found: ${opts.presetId}`);
      const clipInfo = await ctx.services.effects.getSelectedClipInfo();
      if (!clipInfo) throw new Error("No clip selected");
      if (opts.clearExisting) {
        await ctx.services.effects.removeAllEffects(
          clipInfo.trackIndex,
          clipInfo.clipIndex,
          clipInfo.trackType
        );
      }
      const result = await ctx.services.effects.applyEffects(
        clipInfo.trackIndex,
        clipInfo.clipIndex,
        clipInfo.trackType,
        JSON.stringify(preset.effects)
      );
      const msg = `Applied "${preset.name}": ${result.applied.length} applied, ${result.skipped.length} skipped, ${result.errors.length} errors`;
      ctx.ui.showToast(msg, result.errors.length > 0 ? "warning" : "success");
      return result;
    },
    async list(ctx, args) {
      const filter = args ?? {};
      return listPresets(storageDir(ctx), filter);
    },
    async "delete-preset"(ctx, args) {
      const { presetId } = args ?? {};
      if (!presetId) throw new Error("presetId is required");
      const deleted = deletePreset(storageDir(ctx), presetId);
      if (!deleted) throw new Error(`Preset not found: ${presetId}`);
      ctx.ui.showToast("Preset deleted", "info");
      ctx.ui.pushToPanel("preset-deleted", { presetId });
      return { deleted: true };
    },
    async "export-excalibur"(ctx, args) {
      const { format } = args ?? {};
      const index = loadIndex(storageDir(ctx));
      const presets = index.presets;
      if (presets.length === 0) {
        throw new Error("No presets to export");
      }
      switch (format) {
        case "ahk":
          return { format: "ahk", content: generateAHKScript(presets) };
        case "keyboard-maestro":
          return { format: "keyboard-maestro", content: generateKeyboardMaestro(presets) };
        case "excalibur":
        default:
          return { format: "excalibur", content: generateExcaliburGuide(presets) };
      }
    },
    async "save-synthetic"(ctx, args) {
      const { preset } = args ?? {};
      if (!preset) throw new Error("preset object is required");
      if (!preset.id || !preset.name) throw new Error("preset must have id and name");
      const entry = savePreset(storageDir(ctx), preset);
      ctx.log.info(`Saved synthetic preset "${preset.name}" (${entry.effectCount} effects)`);
      ctx.ui.pushToPanel("preset-saved", entry);
      return entry;
    },
    async "clear-effects"(ctx) {
      const clipInfo = await ctx.services.effects.getSelectedClipInfo();
      if (!clipInfo) throw new Error("No clip selected");
      await ctx.services.effects.removeAllEffects(
        clipInfo.trackIndex,
        clipInfo.clipIndex,
        clipInfo.trackType
      );
      ctx.ui.showToast(`Cleared effects from "${clipInfo.clipName}"`, "success");
      return { cleared: true, clipName: clipInfo.clipName };
    }
  }
});
export {
  src_default as default
};
