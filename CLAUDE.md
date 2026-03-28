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

## Excalibur Command Executor
- The executor (`packages/server/src/services/excalibur-executor.ts`) dispatches Excalibur commands from `.cmdlist.json` via handler maps.
- Uses `clipHandlers` (need selected clip: fxvp, fxap, fxcl, fxvf, fxaf, fxvt, fxat) and `noClipHandlers` (fxsq, fxsl, fxex, fxpr, fxpf, fxsp, fxmd).
- ExtendScript modules in `packages/extendscript/src/`: effects.jsx, sequence.jsx, exports.jsx, preferences.jsx, project.jsx, timeline.jsx, markers.jsx.
- Bridge dispatcher in `bridge.jsx` routes `module.function` calls to registered modules.
- Build order in `build.js` matters — modules must be defined before `bridge.jsx`.
- CEP panel install is a symlink: `npm run build:cep` updates files in place, no reinstall needed after first `sudo bash scripts/install-cep.sh`.
- **Known issue**: `qeClip.addVideoEffect()` can return truthy but silently fail. Debug check added: compare `clip.components.numItems` before/after to verify effect was actually added.

## TODO
- Add a `postinstall` script to package.json that auto-rebuilds better-sqlite3 for Electron after every `npm install`, so the ABI conflict is handled automatically.
- Investigate and fix the Drop Shadow effect not applying despite server reporting success (QE DOM `addVideoEffect` silent failure).

## Preferences
- Save memories and project context to this CLAUDE.md file (in the repo) so it persists across machines.
- Always commit and push important changes — don't leave things uncommitted.
- Be proactive about saving context without being asked.
