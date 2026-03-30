# MaydayCreate — Project Context

## Project Overview
MaydayCreate is a plugin development platform for Adobe Premiere Pro 2026. Monorepo with packages (sdk, launcher, cep-panel, cli, server, sync-engine, ui-kit, types, extendscript) and plugins (preset-vault, silence-remover, cutting-board). GitHub repo: IamTrevorMay/Maydaycreate.

## Owner
Trevor May

## Versioning
- **GitHub Releases are the source of truth for version numbers**, not package.json.
- As of 2026-03-28, the latest release is v1.0.2.
- Version was previously out of sync (package.json said 1.0.14 while latest GH release was 1.0.2) due to a version reset.
- When checking or bumping versions, always verify against `gh release list` first.
- Keep version in sync across: package.json, package-lock.json, packages/launcher/package.json, packages/cep-panel/package.json.

## Dev Workflow
- **Run `npm run dev:launcher`** to start the Electron app (it embeds the server via server-bridge.js).
- The standalone `npm run dev` (server only) is separate and optional — the launcher doesn't need it.
- Server runs on port 9876, Electron renderer on 5173/5174.
- **better-sqlite3 ABI conflict**: System Node (ABI 137) and Electron 31 (ABI 125) need different native builds. They share one binary in node_modules. After `npm install`, the binary is built for system Node, which breaks Electron.
- Fix: `cd node_modules/better-sqlite3 && npx prebuild-install -r electron -t 31.7.7`
- The launcher has a **single instance lock** (`app.requestSingleInstanceLock()` in `packages/launcher/src/main/index.ts:100-104`). Stale Electron processes will cause new launches to silently quit. Always kill old Electron processes before relaunching.
- After building/installing, also rebuild and install the CEP panel: `npm run build:cep` then `sudo bash scripts/install-cep.sh`.

## Mayday Shortcuts (Excalibur Integration)
- **Architecture**: User assigns hotkeys to Excalibur commands in Excalibur Settings. Mayday reads the hotkey mapping from SpellBook JSON (`~/Library/Application Support/SpellBook/knights_of_the_editing_table.excalibur.json`). On Stream Deck button press, simulates the keystroke via CGEvents (Swift binary at `tools/keystroke-sender/`). SpellBook's `spell_mac` catches it → Excalibur executes the command natively.
- **Key files**: `excalibur-hotkeys.ts` (reads SpellBook), `keystroke-simulator.ts` (calls Swift binary), `streamdeck-hardware.ts` (button press handler).
- **DO NOT** try to translate Excalibur presets/commands via ExtendScript — this was attempted and abandoned due to complexity (keyframes, QE DOM bugs, property resolution issues). Let Excalibur handle execution natively.
- **DO NOT** write to SpellBook — Excalibur overwrites it on startup. Only read from it.
- CEP panel install is a symlink: `npm run build:cep` updates files in place, no reinstall needed after first `sudo bash scripts/install-cep.sh`.

## TODO
- Add a `postinstall` script to package.json that auto-rebuilds better-sqlite3 for Electron after every `npm install`, so the ABI conflict is handled automatically.

## Progress (2026-03-29)
1. **Mayday Shortcuts**: ✅ Working. Hotkey-based execution via SpellBook + CGEvents. User assigns hotkeys in Excalibur Settings, Mayday simulates them.
2. **Cutting Board**: In progress — training workflow rework underway.
   - ✅ Cloud Model Registry: Training runs auto-push (awaited, not fire-and-forget) to `autocut_models` Supabase table on every train.
   - ✅ UI restructured into 3 tabs: Cut Watcher, Cut Finder, Training (with monster animation).
   - ✅ Session lifecycle: sessions close on CEP disconnect + orphan cleanup on plugin activation.
   - ✅ Deleted 37 empty (0-edit) sessions from local DB.
   - 🔧 **ACTIVE BUG — Workout Queue shows 0 data**: The `getTrainingDataSummary` IPC handler queries Supabase `cut_records` with `gt('detected_at', lastTrainedAt)` but either the column type mismatch (epoch ms vs timestamptz) or the query is failing silently. Needs debugging — add error logging, verify Supabase column types for `detected_at` and `trained_at`.
   - 🔧 **ACTIVE BUG — Personal Records not updating after train**: May be fixed (cloud push is now awaited) but untested since the Workout Queue bug blocks training (shows 0 data).
3. **Release-ready packaging**: Not started. Download on a new machine → all dependencies install perfectly without needing Claude Code.

## Training System Design (IMPORTANT — do not deviate)
- **Supabase is the single source of truth** for training data. All machines push cut_records to Supabase. Training pulls ALL records from cloud (all machines) and retrains from scratch.
- **Full retrain every time** — no incremental training. brain.js model is small, training is fast, and full retrain avoids catastrophic forgetting.
- **Workout Queue (left panel)** shows records captured SINCE last training run (cloud-wide, not local-only).
- **Personal Records (right panel)** shows the cloud model registry (all machines).
- **DO NOT** train on local records only. DO NOT use fire-and-forget for cloud push. DO NOT show local-only counts in the Workout Queue.
- Sessions end when: stop-capture called, CEP panel disconnects, launcher closes, or Premiere closes.
- Orphaned sessions (crashed without clean shutdown) are closed on plugin activation.

## Build Steps (must do after code changes)
- Server changes: `npm run build:server` then restart launcher
- CEP panel changes: `npm run build:cep` then restart Premiere
- Launcher changes: restart `npm run dev:launcher` (kills old Electron first)

## Preferences
- Save memories and project context to this CLAUDE.md file (in the repo) so it persists across machines.
- Always commit and push important changes — don't leave things uncommitted.
- Be proactive about saving context without being asked.
