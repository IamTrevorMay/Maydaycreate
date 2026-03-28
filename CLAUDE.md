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

## Preferences
- Save memories and project context to this CLAUDE.md file (in the repo) so it persists across machines.
- Always commit and push important changes — don't leave things uncommitted.
- Be proactive about saving context without being asked.
