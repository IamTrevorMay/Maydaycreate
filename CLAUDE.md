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

### PathGuard — Paused 2026-04-18
- **Status**: Paused at start of Step 2.
- **Next concrete action when resuming**: Add a dev-only "Test Scan" button to `PathGuardPanel.tsx` that uses `CSInterface.evalScript` to load `plugins/pathguard/extendscript/pathguard.jsx` via `$.evalFile()` and calls `MaydayPathGuard.scanProject()` directly. Display item count, projectPath, and first few results. This bypasses the server stub — server bridge is Step 3.
- **Test against**: A real Premiere project with varied bins, nested folders, offline media, and sequences to exercise edge cases in `walkItem()` (bins recurse, sequences skipped, offline throws on `getMediaPath`).
- **Known**: Scanner `MaydayPathGuard.scanProject()` is written but untested in Premiere. Server command `scan-project` is still a stub.
- **Parking note — main branch stash**: `stash@{0}` on main holds Excalibur preset keyframe remap + value resolution WIP from 2026-03-28 (`effects.jsx`, `excalibur-executor.ts`). Unrelated to PathGuard; pop when returning to Excalibur work.

## Bug Fix Audit (2026-04-24)

Full codebase security and reliability audit completed. **33 bugs fixed** in commit `ba058e0` on `feature/pathguard`, across 31 files. Both `build:server` and `build:cep` pass clean.

### Critical Fixes (6)
1. **Infinite recursion in `detectSilence`** — `media.ts` catch block recursed with same args on stderr match; now parses stderr directly.
2. **`lstatSync` crash** — `install.ts` called lstatSync on non-existent path; wrapped in try-catch.
3. **`eval()` in JSON polyfill** — `json2.jsx` used `eval("(" + text + ")")` for JSON.parse; replaced with safe recursive-descent parser (ES3-compatible).
4. **Shell injection in curl** — `excalibur.ts` interpolated presetId into shell command; added UUID format validation.
5. **Path traversal in sync merger** — `merger.ts` had no validation on `diff.relativePath`; added `safePath()` helper.
6. **Path traversal in preset storage** — `storage.ts` used presetId in path.join unsafely; added `SAFE_ID_RE` validation.

### High Fixes (7)
7. **Uncleared `setInterval`** — `server-bridge.ts` never cleared status interval; now stored and cleared on stop.
8. **Errored plugin blocks reload** — `lifecycle.ts` kept errored entries in map; now deletes on failure.
9. **SQL table name interpolation** — `db.ts` interpolated `table` param; added whitelist check.
10. **StreamDeck `setMode` race** — `streamdeck-hardware.ts` fired async renders without awaiting; added render queue.
11. **Optimistic mode update** — `StreamDeckApp.tsx` set mode before server confirmed; removed, relies on server response.
12. **Hardcoded config path** — `config-store.ts` had machine-specific path; changed to empty string default.
13. **Hardcoded CLI version/port** — `index.ts`, `enable.ts`, `disable.ts`; reads from package.json, added `--port` option.

### Medium Fixes (20)
14. **Temp file collision** — `whisper.ts` used `Date.now()` for two files in same tick; added random suffix.
15. **Missing `destroyTray`** — `index.ts` never called destroyTray on quit; added to before-quit handler.
16. **Auto-sync blocks handlers** — `cutting-board-ipc.ts` startCutWatcherAutoSync could throw, skipping all handler registration; isolated in own try-catch.
17. **Silent catch** — `cutting-board-ipc.ts` empty catch in getTrainingDataSummary; added logging.
18. **Timeout leak** — `auto-updater.ts` Promise.race timeout never cleared; now cleared in finally.
19. **Protocol path overlap** — `plugin-page-protocol.ts` startsWith without path.sep; added separator check.
20. **Empty youtu.be ID** — `VideoIdBar.tsx` returned full URL for bare youtu.be/; returns empty string.
21. **Toast timer reset** — `Toast.tsx` onClose in deps caused resets; removed from dependency array.
22. **Stale dropdown on mode switch** — `StreamDeckGrid.tsx` activeSlot not cleared; added useEffect.
23. **Build error suppressed** — `build.ts` stdio:pipe hid errors; now logs stderr/stdout.
24. **Missing source check** — `build.js` no validation before reading ExtendScript files; added existence check.
25. **Empty plugin name** — `create.ts` no validation; added name checks.
26. **Malformed manifest crash** — `list.ts` JSON.parse without try-catch; wrapped with warning.
27. **Unsafe JSON.parse** — `excalibur-executor.ts` cmdlist/preset parsing; wrapped in try-catch.
28. **Dedup precision** — `diff.ts` toFixed(1) too coarse (100ms); changed to toFixed(2) (10ms).
29. **Null tag crash** — `pipeline.ts` JSON.parse('null') returns null; added nullish coalescing + Array.isArray guard.
30. **Non-atomic writes** — `storage.ts` writeFileSync can corrupt; now writes to .tmp then renames.
31. **Duplicate API call** — `audit-excalibur.mjs` called clip/properties twice; removed unused second call.
32. **Silent sync errors** — `index.ts` pushChanges catch swallowed errors; added error logging.

### Assessed & Skipped (not bugs)
scanner.ts lazy hash (perf tradeoff), streamdeck-config.ts type assertion (validated), ai.ts textBlock (runtime-safe), websocket.ts reconnect (handled by onclose), StreamDeckGrid drag null (guarded), install-cep.sh sudo (set -e), timeline.jsx clip index (bounds-checked), sdk/ui.ts postMessage '*' (required for Electron), keystroke-simulator.ts permissions (EACCES rejected), model.ts tag vector (full retrain design), registry.ts concurrent (synchronous sqlite3), doctor.ts macOS paths (v1 by design).

## Modular Plugin Architecture Migration

**Goal**: Refactor from monolithic monorepo to modular ecosystem where the launcher is a plugin manager and each plugin is independently versioned, released, and installed from GitHub Releases.

### Phase 1: Plugin installer infrastructure — ✅ COMPLETE (2026-04-27)
Launcher can install/update/uninstall plugins from GitHub Releases.

**New files**:
- `plugin-compatibility.json` — registry of available plugins with repo URLs, compatible versions
- `packages/launcher/src/main/plugin-manager.ts` — download, extract, install, update, uninstall from GitHub Releases
- `packages/types/src/launcher.ts` — new types: InstalledPluginRecord, AvailablePluginInfo, PluginInstallProgress, etc.

**Modified files**:
- `packages/types/src/plugin.ts` — added `repository`, `minSdkVersion`, `hasCep` to PluginManifest
- `packages/server/src/plugins/loader.ts` — `addPluginDirectory()` to scan external plugin dirs, `scanDirectory()` refactored
- `packages/server/src/plugins/lifecycle.ts` — pre-built `.mjs`/`.js` plugins skip esbuild transpilation
- `packages/server/src/server.ts` — `externalPluginsDirs` in ServerConfig, passed to loader
- `packages/launcher/src/main/server-bridge.ts` — passes `userData/plugins/` as external plugins dir
- `packages/launcher/src/main/config-store.ts` — `installedPlugins` tracking with add/remove/update helpers, `getExternalPluginsDir()`, `getCepExtensionsDir()`
- `packages/launcher/src/main/ipc-handlers.ts` — new IPC: `plugins:getAvailable`, `plugins:installFromRepo`, `plugins:update`, `plugins:uninstall`, `plugins:checkUpdates`
- `packages/launcher/src/preload/index.ts` — exposed new IPC methods + `onInstallProgress` event
- `packages/launcher/src/renderer/pages/MarketplacePage.tsx` — full Plugin Manager UI with Available/Installed sections, install/update/uninstall buttons, progress banner

**Plugin install flow**: User clicks Install → GitHub API fetch latest release → download zip → extract to `userData/plugins/{id}/` → install CEP extension (version-suffixed) → loadPlugin + activatePlugin.

**CEP cache busting**: Extensions installed as `com.mayday.{id}.v{version}/` — version suffix busts Premiere's aggressive cache.

### Phase 2: Extract Mayday Core CEP extension — ✅ COMPLETE (2026-04-27)
Created `packages/cep-core/` as a separate CEP extension (`com.mayday.core`).

**New files**:
- `packages/cep-core/CSXS/manifest.xml` — Extension ID `com.mayday.core.bridge`
- `packages/cep-core/client/bridge.html` — WebSocket connection + ExtendScript serial queue + CSEvent dispatch
- `packages/cep-core/client/lib/CSInterface.js` — Adobe library copy
- `packages/cep-core/build.js` — Copies client files + builds ExtendScript bundle to `dist/cep-core/`

**Modified files**:
- `scripts/install-cep.sh` — Installs both `com.mayday.core` and `com.mayday.create`
- `package.json` — Added `build:cep-core` script

**Core bridge provides**: WebSocket to server, ExtendScript serial queue, inter-extension CSEvent dispatch (`mayday:message`, `mayday:eval`, `mayday:send`, `mayday:connected`, `mayday:disconnected`). Plugin panels communicate through CSEvents rather than each maintaining their own WebSocket.
### Phase 3: Extract premiere-pro-sync plugin — 🔲 NOT STARTED
### Phase 4: Extract remaining plugins to repos — 🔲 NOT STARTED
### Phase 5: Launcher repo cleanup — 🔲 NOT STARTED
### Phase 6: Cutting Board IPC migration — 🔲 NOT STARTED

## Build Steps (must do after code changes)
- Server changes: `npm run build:server` then restart launcher
- CEP panel changes: `npm run build:cep` then restart Premiere
- Launcher changes: restart `npm run dev:launcher` (kills old Electron first)

## Preferences
- Save memories and project context to this CLAUDE.md file (in the repo) so it persists across machines.
- Always commit and push important changes — don't leave things uncommitted.
- Be proactive about saving context without being asked.
