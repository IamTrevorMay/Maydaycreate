# Mayday Create — Plugin Development Guide

This guide covers everything you need to build, install, and publish a plugin for Mayday Create.

---

## Quick Start

1. Copy `templates/plugin-template/` into `plugins/your-plugin-name/`
2. Edit `mayday.json` with your plugin's details
3. Write your logic in `src/index.ts`
4. The launcher hot-reloads on save — your plugin appears automatically

---

## Plugin Structure

```
plugins/
  your-plugin/
    mayday.json         ← manifest (required)
    src/
      index.ts          ← server-side entry point (required)
    ui/                 ← optional: plugin UI page
      index.html
      main.ts
```

---

## Manifest Reference (`mayday.json`)

Every plugin must have a `mayday.json` in its root directory.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier. Lowercase, alphanumeric + hyphens. Must start with a letter. |
| `name` | `string` | Display name shown in marketplace and sidebar. |
| `version` | `string` | Semver version string (e.g. `"0.1.0"`). |
| `description` | `string` | One-line description for the marketplace card. |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `author` | `string` | — | Author name. |
| `main` | `string` | `"src/index.ts"` | Path to the plugin entry point relative to plugin root. |
| `commands` | `PluginCommand[]` | — | Commands exposed via the HTTP API. |
| `permissions` | `string[]` | — | Services this plugin needs: `timeline`, `media`, `ai`, `effects`, `filesystem`, `network`. |
| `config` | `object` | — | Settings schema for auto-generated UI. See [Config Schema](#config-schema). |
| `ui` | `object` | — | UI declarations. See [UI Declaration](#ui-declaration). |
| `marketplace` | `object` | — | Metadata for marketplace display. See [Marketplace Metadata](#marketplace-metadata). |
| `dependencies` | `string[]` | — | IDs of plugins this one depends on. |
| `targetApp` | `string` | — | Target application: `"premiere"`, `"davinci"`, or `"any"`. |

### UI Declaration (`ui`)

```json
{
  "ui": {
    "page": true,
    "sidebarLabel": "My Plugin",
    "sidebarIcon": "icon.svg",
    "sidebarOrder": 100,
    "rendererEntry": "ui/index.html"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `page` | `boolean` | If `true`, plugin gets its own sidebar tab and full page. |
| `sidebarLabel` | `string` | Label in sidebar. Defaults to `name`. |
| `sidebarIcon` | `string` | Icon key or relative path to SVG/PNG. |
| `sidebarOrder` | `number` | Sort position in sidebar. Lower = higher. Default `100`. |
| `rendererEntry` | `string` | Path to the plugin's UI page (e.g. `"ui/index.html"`). Loaded in a sandboxed iframe. |

### Config Schema (`config`)

Defines settings that get an auto-generated UI panel (gear icon on plugin page).

```json
{
  "config": {
    "threshold": {
      "type": "number",
      "label": "Silence Threshold (dB)",
      "default": -30,
      "description": "Audio level below which is considered silence"
    },
    "enabled": {
      "type": "boolean",
      "label": "Auto-detect on import",
      "default": true
    },
    "quality": {
      "type": "select",
      "label": "Analysis Quality",
      "default": "normal",
      "options": [
        { "label": "Fast", "value": "fast" },
        { "label": "Normal", "value": "normal" },
        { "label": "High", "value": "high" }
      ]
    }
  }
}
```

Supported types: `string`, `number`, `boolean`, `select`.

### Marketplace Metadata (`marketplace`)

```json
{
  "marketplace": {
    "category": "editing",
    "tags": ["audio", "silence"],
    "icon": "icon.png",
    "screenshots": ["screenshots/main.png"],
    "homepage": "https://github.com/...",
    "repository": "https://github.com/..."
  }
}
```

Categories: `editing`, `analysis`, `effects`, `automation`, `hardware`, `utility`.

---

## Plugin Entry Point (`src/index.ts`)

```typescript
import { definePlugin } from '@mayday/sdk';

export default definePlugin({
  async activate(ctx) {
    ctx.log.info('Plugin activated!');
  },

  async deactivate(ctx) {
    // Clean up resources (optional)
  },

  commands: {
    'my-command': async (ctx, args) => {
      const seq = await ctx.services.timeline.getActiveSequence();
      ctx.ui.showToast(`Sequence: ${seq?.name ?? 'none'}`);
      return { name: seq?.name };
    },
  },
});
```

### Plugin Context (`ctx`)

The `ctx` object is passed to `activate()`, `deactivate()`, and all command handlers.

| Property | Description |
|----------|-------------|
| `ctx.pluginId` | This plugin's ID. |
| `ctx.services.timeline` | Timeline manipulation (get clips, add markers, split, etc.). Requires `"timeline"` permission. |
| `ctx.services.media` | Audio/video analysis (detect silence, get waveform, metadata). Requires `"media"` permission. |
| `ctx.services.ai` | LLM completions and streaming. Requires `"ai"` permission. |
| `ctx.services.effects` | Effect property reading via Excalibur. Requires `"effects"` permission. |
| `ctx.config` | Live config values (from manifest defaults + user overrides). |
| `ctx.data` | Key-value store: `get(key)`, `set(key, value)`, `delete(key)`, `list()`. Persisted per-plugin in SQLite. |
| `ctx.ui` | `showToast(msg, type)`, `showProgress(label, pct)`, `hideProgress()`, `pushToPanel(type, data)`. |
| `ctx.log` | Scoped logger: `info()`, `warn()`, `error()`, `debug()`. |
| `ctx.dataDir` | Absolute path to this plugin's data directory on disk. |
| `ctx.onEvent(type, handler)` | Subscribe to EventBus events. Returns `{ unsubscribe() }`. |

### Permissions

Plugins must declare which services they need in `permissions`. Accessing an undeclared service throws an error at runtime.

```json
"permissions": ["timeline", "media"]
```

---

## Plugin UI Page

Plugins can have their own full page in the launcher by setting `ui.page: true` and `ui.rendererEntry`.

### How it works

1. Your `ui/index.html` is served via a custom `mayday-plugin://` protocol
2. It loads in a sandboxed iframe inside the launcher
3. Communication with the host happens via `postMessage`

### Setup

**`ui/index.html`:**
```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { margin: 0; font-family: -apple-system, sans-serif; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

**`ui/main.ts`** (compile to `main.js`):
```typescript
import { MaydayPluginUI } from '@mayday/sdk/ui';

const ui = new MaydayPluginUI();

// Receive design tokens from the host
ui.onTheme((tokens) => {
  document.body.style.background = tokens.bg.primary;
  document.body.style.color = tokens.text.primary;
});

// Execute a command defined in src/index.ts
const result = await ui.executeCommand('my-command', { clip: 'intro' });

// Show a toast in the launcher
ui.showToast('Done!', 'success');
```

### SDK UI Methods

| Method | Description |
|--------|-------------|
| `executeCommand(id, args?)` | Execute a plugin command via the server. Returns a Promise. |
| `showToast(message, level?)` | Show a toast notification. Level: `info`, `success`, `warning`, `error`. |
| `onTheme(handler)` | Receive design tokens when the host sends them. |
| `onConfig(handler)` | Receive config values when they change. |
| `onMessage(handler)` | Receive any message from the host. |

### postMessage Protocol

If you prefer not to use the SDK, you can use `postMessage` directly:

**Plugin → Host:**
- `{ type: 'plugin:ready' }` — Announce the page has loaded
- `{ type: 'plugin:command', command, args?, reqId? }` — Execute a command
- `{ type: 'plugin:toast', message, level? }` — Show a toast

**Host → Plugin:**
- `{ type: 'host:theme', tokens }` — Design token object
- `{ type: 'host:config', config }` — Plugin config values
- `{ type: 'host:command-result', reqId, result?, error? }` — Command response

---

## Hot Reload

During development, the server watches `plugins/*/src/**/*.ts` for changes. When a file changes:

1. The plugin is deactivated
2. Source is rebuilt via esbuild (bundled to `.mayday-build/index.mjs`)
3. The plugin is reactivated

Changes are picked up within ~300ms. No restart needed.

---

## Installation

### During development

Drop your plugin folder into `plugins/`. The server scans on startup.

### For users

Use the **Marketplace → Install from Disk** button. Select the plugin folder — it must contain a `mayday.json`. The plugin is copied to the plugins directory and activated immediately.

---

## Commands API

Commands are accessible via HTTP:

```
POST http://localhost:{port}/api/plugins/{plugin-id}/command/{command-id}
Content-Type: application/json

{ "arg1": "value" }
```

The response is the return value of the command handler, JSON-encoded.

---

## Design Tokens

When building UI pages, use the Mayday design tokens for a consistent look:

| Token | Value | Usage |
|-------|-------|-------|
| `bg.primary` | `#1e1e1e` | Main background |
| `bg.secondary` | `#232323` | Sidebar, panels |
| `bg.elevated` | `#303030` | Cards, modals |
| `bg.hover` | `#383838` | Hover states |
| `text.primary` | `#e0e0e0` | Main text |
| `text.secondary` | `#999999` | Labels, descriptions |
| `text.disabled` | `#666666` | Disabled text |
| `accent.primary` | `#2680eb` | Buttons, links, active states |
| `border.default` | `#333333` | Borders |
| `status.success` | `#4ade80` | Success indicators |
| `status.warning` | `#fbbf24` | Warning indicators |
| `status.error` | `#f87171` | Error indicators |

These are sent to plugin UI pages via the `host:theme` message on load.
