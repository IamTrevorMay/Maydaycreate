# MaydayCreate — Project Context

## Project Overview
MaydayCreate is a plugin development platform for Adobe Premiere Pro 2026. Monorepo with packages (sdk, launcher, cep-panel, cli, server, sync-engine, ui-kit, types, extendscript) and plugins (preset-vault, silence-remover, cutting-board, pathguard). GitHub repo: IamTrevorMay/Maydaycreate.

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

## Progress (2026-03-30)
1. **Mayday Shortcuts**: ✅ Working. Hotkey-based execution via SpellBook + CGEvents. User assigns hotkeys in Excalibur Settings, Mayday simulates them.
   - ✅ Renamed CEP panel from "Mayday Stream Deck" → "Mayday Shortcuts" (HTML title + built manifest).
   - **IMPORTANT**: After assigning hotkeys in Excalibur Settings, **Premiere must be restarted** for Excalibur to reload SpellBook and activate the bindings. Without restart, hotkeys won't fire even though SpellBook JSON is updated.
   - The built manifest at `dist/cep/CSXS/manifest.xml` can get stale — `cp -R` in the build script doesn't always overwrite. Force-copy with `cp -f` if the menu name is wrong.
2. **Cutting Board**: In progress — training workflow rework underway.
   - ✅ Cloud Model Registry: Training runs auto-push (awaited, not fire-and-forget) to `autocut_models` Supabase table on every train.
   - ✅ UI restructured into 3 tabs: Cut Watcher, Cut Finder, Training (with monster animation).
   - ✅ Session lifecycle: sessions close on CEP disconnect + orphan cleanup on plugin activation.
   - ✅ Deleted 37 empty (0-edit) sessions from local DB.
   - 🔧 **ACTIVE BUG — Workout Queue shows 0 data**: The `getTrainingDataSummary` IPC handler queries Supabase `cut_records` with `gt('detected_at', lastTrainedAt)` but either the column type mismatch (epoch ms vs timestamptz) or the query is failing silently. Needs debugging — add error logging, verify Supabase column types for `detected_at` and `trained_at`.
   - 🔧 **ACTIVE BUG — Personal Records not updating after train**: May be fixed (cloud push is now awaited) but untested since the Workout Queue bug blocks training (shows 0 data).
3. **Release-ready packaging**: Not started. Download on a new machine → all dependencies install perfectly without needing Claude Code.
4. **PathGuard**: In progress on `feature/pathguard` branch. Build Step 1 (scaffolding) complete — plugin loads and builds. Next: Build Step 2 (ExtendScript scanner testing in Premiere).

## Training System Design (IMPORTANT — do not deviate)
- **Supabase is the single source of truth** for training data. All machines push cut_records to Supabase. Training pulls ALL records from cloud (all machines) and retrains from scratch.
- **Full retrain every time** — no incremental training. brain.js model is small, training is fast, and full retrain avoids catastrophic forgetting.
- **Workout Queue (left panel)** shows records captured SINCE last training run (cloud-wide, not local-only).
- **Personal Records (right panel)** shows the cloud model registry (all machines).
- **DO NOT** train on local records only. DO NOT use fire-and-forget for cloud push. DO NOT show local-only counts in the Workout Queue.
- Sessions end when: stop-capture called, CEP panel disconnects, launcher closes, or Premiere closes.
- Orphaned sessions (crashed without clean shutdown) are closed on plugin activation.

## PathGuard Plugin (branch: `feature/pathguard`)

**Goal**: CEP plugin that prevents broken media links by introducing a symlink indirection layer. When media is imported, PathGuard creates a managed symlink and relinks Premiere to it. A background daemon watches for file moves/renames and updates symlink targets. Premiere only ever sees the stable symlink path.

**Architecture** — three components:
1. **Server-side plugin** (`plugins/pathguard/src/index.ts`) — manages SQLite DB, symlink CRUD, reconciliation
2. **ExtendScript** (`plugins/pathguard/extendscript/pathguard.jsx`) — runs in Premiere's scripting context. Walks project tree (`scanProject`), relinks items (`changeMediaPath`). Loaded via `$.evalFile()` from CEP panel, NOT through the central bridge.
3. **Background daemon** (`plugins/pathguard/daemon/`) — standalone Node process via `launchd`. Uses chokidar to watch NAS paths. Detects moves via partial-hash matching. Updates symlinks + DB independently of Premiere.

**Key design constraints**:
- Premiere has no `onImport` event — must poll project tree on interval (2s default) + backstop on `ProjectEvent.EVENT_SAVE`
- Partial file hashing: first 64KB + last 64KB + file size (full SHA-256 only on collision)
- Daemon runs 24/7 independently of Premiere
- After `changeMediaPath()`, call `item.refreshMedia()` (feature-flagged, version-dependent)
- **Never corrupt a .prproj** — back up project before any writes
- macOS-only for v1 (symlinks); Windows junction abstraction layer for later

**Build order** (each step validates before next):
1. ✅ **Project scaffolding** — directory structure, manifest, package.json, CEP panel component. Plugin loads, builds clean.
2. 🔲 **ExtendScript project tree scanner** — implement+test `scanProject()` in Premiere
3. 🔲 **CEP ↔ ExtendScript bridge** — wire `CSInterface.evalScript` with JSON payloads, poll every 2s
4. 🔲 **Symlink creation + manual relink (CRITICAL VALIDATION)** — create symlink, call `changeMediaPath()`, save/close/reopen project. **If Premiere resolves symlinks to real paths on save, the entire architecture fails — pivot to project file rewriter.** Do NOT proceed past this step without confirming.
5. 🔲 **SQLite schema + partial hash indexing**
6. 🔲 **NAS watcher daemon** — chokidar, move detection via hash matching, launchd plist
7. 🔲 **Panel startup reconciliation** — verify all symlinks, repair stale ones
8. 🔲 **Error handling and observability** — NAS disconnect, permissions, crash recovery, structured logging

**Key files**:
- `plugins/pathguard/mayday.json` — manifest (3 commands, 4 config fields, media+filesystem perms)
- `plugins/pathguard/src/index.ts` — server plugin entry (stubs, creates symlink root dir on activate)
- `plugins/pathguard/src/types.ts` — TrackedFile, ScanResult, ProjectItemInfo, PathGuardStatus, ReconcileResult
- `plugins/pathguard/extendscript/pathguard.jsx` — `MaydayPathGuard.scanProject()`, `.changeMediaPath()`, `.getMediaPath()`
- `plugins/pathguard/daemon/com.mayday.pathguard.plist` — launchd template
- `packages/cep-panel/src/components/PathGuardPanel.tsx` — CEP panel UI (wired into App.tsx)

**Non-goals for v1**: Windows support, multi-machine DB sync, UI polish, retroactive relinking of existing projects, Dynamic Link/AE integration, proxy workflows.

## Build Steps (must do after code changes)
- Server changes: `npm run build:server` then restart launcher
- CEP panel changes: `npm run build:cep` then restart Premiere
- Launcher changes: restart `npm run dev:launcher` (kills old Electron first)

## Preferences
- Save memories and project context to this CLAUDE.md file (in the repo) so it persists across machines.
- Always commit and push important changes — don't leave things uncommitted.
- Be proactive about saving context without being asked.
