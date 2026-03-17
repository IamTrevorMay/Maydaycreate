"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/plugin.ts
var import_streamdeck = __toESM(require("@elgato/streamdeck"), 1);
var import_fs = require("fs");
var import_path = require("path");
var import_os = require("os");
var import_child_process = require("child_process");
var EXCALIBUR_DIR = (0, import_path.join)(
  (0, import_os.homedir)(),
  "Library",
  "Application Support",
  "Knights of the Editing Table",
  "excalibur"
);
var CMDLIST_PATH = (0, import_path.join)(EXCALIBUR_DIR, ".cmdlist.json");
var SHORTCUTS_PATH = (0, import_path.join)(EXCALIBUR_DIR, ".shortcuts.json");
var CATEGORY_LABELS = {
  us: "User Commands",
  cl: "Clip",
  sq: "Sequence",
  sl: "Selection",
  ex: "Export",
  pr: "Project",
  pf: "Preferences",
  sp: "Special",
  vf: "Video Effects",
  af: "Audio Effects",
  vp: "Video Presets",
  ap: "Audio Presets",
  vt: "Video Transitions",
  at: "Audio Transitions"
};
function readExcaliburCommands() {
  try {
    const cmdlistRaw = (0, import_fs.existsSync)(CMDLIST_PATH) ? (0, import_fs.readFileSync)(CMDLIST_PATH, "utf-8") : "{}";
    const shortcutsRaw = (0, import_fs.existsSync)(SHORTCUTS_PATH) ? (0, import_fs.readFileSync)(SHORTCUTS_PATH, "utf-8") : "{}";
    const cmdlist = JSON.parse(cmdlistRaw);
    const shortcuts = JSON.parse(shortcutsRaw);
    const commands = [];
    for (const [cat, entries] of Object.entries(cmdlist)) {
      const categoryLabel = CATEGORY_LABELS[cat] ?? cat;
      for (const [name, cmd] of Object.entries(entries)) {
        if (cmd.show !== 1)
          continue;
        commands.push({
          id: `${cat}:${name}`,
          name,
          category: cat,
          categoryLabel,
          shortcut: parseShortcut(shortcuts[name])
        });
      }
    }
    return commands;
  } catch (err) {
    import_streamdeck.default.logger.error("Failed to read Excalibur commands:", err);
    return [];
  }
}
function parseShortcut(raw) {
  if (!raw)
    return null;
  if (typeof raw === "string") {
    const dotIdx = raw.indexOf(".");
    if (dotIdx === -1) {
      return raw ? { key: raw, modifiers: [] } : null;
    }
    const key = raw.slice(0, dotIdx);
    const modsStr = raw.slice(dotIdx + 1);
    const modifiers = modsStr.split("_").map((m) => m.replace(/^m$/, "shift")).filter(Boolean);
    return key ? { key, modifiers } : null;
  }
  if (typeof raw === "object") {
    if (!raw.v)
      return null;
    const modifiers = [];
    if (raw.a)
      modifiers.push(raw.a);
    return { key: raw.v, modifiers };
  }
  return null;
}
var MOD_MAP = {
  cmd: "command down",
  command: "command down",
  shift: "shift down",
  m: "shift down",
  alt: "option down",
  option: "option down",
  ctrl: "control down",
  control: "control down"
};
function simulateKeystroke(key, modifiers) {
  const mods = modifiers.map((m) => MOD_MAP[m.toLowerCase()]).filter(Boolean);
  let script;
  if (mods.length > 0) {
    script = `tell application "System Events" to keystroke "${key}" using {${mods.join(", ")}}`;
  } else {
    script = `tell application "System Events" to keystroke "${key}"`;
  }
  (0, import_child_process.exec)(`osascript -e '${script}'`, (err) => {
    if (err) {
      import_streamdeck.default.logger.error("AppleScript keystroke failed:", err.message);
    }
  });
}
var ExcaliburCommandAction = class extends import_streamdeck.SingletonAction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onWillAppear(ev) {
    const settings = ev.payload.settings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onKeyDown(ev) {
    const settings = ev.payload.settings;
    if (!settings.shortcutKey) {
      import_streamdeck.default.logger.warn(
        `No shortcut for command "${settings.commandName}" \u2014 assign one in Excalibur Settings`
      );
      await ev.action.showAlert();
      return;
    }
    try {
      simulateKeystroke(settings.shortcutKey, settings.shortcutModifiers ?? []);
    } catch (err) {
      import_streamdeck.default.logger.error("Keystroke simulation failed:", err);
      await ev.action.showAlert();
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onDidReceiveSettings(ev) {
    const settings = ev.payload.settings;
    if (settings.commandName) {
      ev.action.setTitle(settings.commandName);
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSendToPlugin(ev) {
    const payload = ev.payload;
    if (payload.event === "getCommands") {
      const commands = readExcaliburCommands();
      ev.action.sendToPropertyInspector({ event: "commands", commands });
    }
  }
};
import_streamdeck.default.actions.registerAction(new ExcaliburCommandAction());
for (const filePath of [CMDLIST_PATH, SHORTCUTS_PATH]) {
  if ((0, import_fs.existsSync)(filePath)) {
    (0, import_fs.watchFile)(filePath, { interval: 5e3 }, () => {
      import_streamdeck.default.logger.info(`Excalibur file changed: ${filePath}`);
    });
  }
}
import_streamdeck.default.connect();
//# sourceMappingURL=plugin.js.map
