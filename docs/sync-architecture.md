# Mayday Create — Sync Architecture

## Overview

Mayday Create syncs data across machines using two mechanisms:

1. **Supabase Cloud Sync** — Real-time bidirectional sync for presets, Stream Deck configs, and editing analytics
2. **Local SyncEngine** — Filesystem-based sync for Premiere Pro configuration files via a shared folder (e.g., Dropbox, iCloud, NAS)

---

## Supabase Cloud Sync

### Stream Deck Config

**Table:** `streamdeck_configs`
**Service:** `StreamDeckSyncService` (`packages/launcher/src/main/streamdeck-sync.ts`)
**Direction:** Bidirectional
**Frequency:** Every 30 seconds + immediate push on local file change (1s debounce)
**Local Storage:** `~/.config/Mayday Create/plugin-data/streamdeck-config.json`

```
{
  id: string                    // machine_id
  machine_name: string
  updated_at: string            // ISO timestamp
  config: {
    version: 2
    deviceModel: string         // "original" | "mini" | "xl" | "mk2" | "pedal" | "plus"
    lastUpdated: string         // ISO timestamp
    buttons: [{
      slot: number              // 0-based button index
      label: string | null      // Display label on physical device
      macroId: string | null    // Excalibur command name
    }]
  }
}
```

Auto-migrates v1 configs (no `deviceModel` field) to v2 with `deviceModel: "original"` on pull.

---

### Effect Presets

**Table:** `presets`
**Service:** `PresetSyncService` (`packages/launcher/src/main/preset-sync.ts`)
**Direction:** Bidirectional
**Frequency:** Every 30 seconds, full reconciliation 12 seconds after startup
**Local Storage:** `~/.config/Mayday Create/plugin-data/preset-vault/presets/*.json`

```
{
  id: string                    // UUID
  name: string
  version: number
  tags: string[]
  folder: string                // Organizational path
  description: string
  source_clip_name: string
  include_intrinsics: boolean
  effects: [{
    displayName: string
    matchName: string           // e.g., "AE.ADBE Motion"
    isIntrinsic: boolean
    properties: [{
      displayName: string
      matchName: string
      value: any
      type: number
      keyframes: any | null
    }]
  }]
  machine_id: string
  machine_name: string
  is_deleted: boolean
  deleted_at: string | null     // ISO timestamp (soft delete)
  created_at: string            // ISO timestamp
  updated_at: string            // ISO timestamp
}
```

Uses a queue-based system for push/delete operations and tracks `lastPulledAt` watermark to avoid redundant pulls.

---

### Cutting Board Analytics

**Tables:** `sessions`, `cut_records`, `autocut_models`
**Service:** `SupabaseSyncService` (`packages/server/src/services/supabase-sync.ts`)
**Direction:** Push-only for edits, bidirectional for ML models
**Frequency:** Every 30 seconds for edits, every 5 minutes for model pull

#### Sessions

```
{
  local_id: number
  machine_id: string
  machine_name: string
  sequence_id: string
  sequence_name: string
  started_at: string            // ISO timestamp
  ended_at: string | null
  total_edits: number
}
```

#### Cut Records

```
{
  local_id: number
  machine_id: string
  session_local_id: number
  edit_type: string             // "clip_moved", "clip_trimmed", etc.
  edit_point_time: number
  clip_name: string
  media_path: string
  track_index: number
  track_type: "video" | "audio"
  before_state: object | null   // Serialized ClipFingerprint
  after_state: object | null    // Serialized ClipFingerprint
  audio_category: string | null
  rating: number | null         // 0 = thumbs down, 1 = thumbs up
  voice_transcript: string | null
  notes: string | null
  is_undo: boolean
  detected_at: number           // Timestamp
  feedback_at: number | null    // Timestamp
  boosted: boolean
}
```

#### Autocut Models

```
{
  machine_id: string
  machine_name: string
  version: number
  trained_at: number            // Timestamp
  training_size: number         // Sample count
  accuracy: number              // 0-1
  model_json: {
    classifier: object          // Serialized ML model
    regressors: Record<string, object>
  }
  uploaded_at: string           // ISO timestamp
}
```

---

## Local SyncEngine (Premiere Pro Config Files)

**Service:** `SyncEngine` (`packages/sync-engine/src/engine.ts`)
**Storage:** `{syncSourcePath}/configs/{source-name}/`
**Mechanism:** Manifest-based with file hash tracking, supports snapshot/restore

These files are synced via a shared local folder — not through Supabase.

| Source | Path | Files |
|--------|------|-------|
| Keyboard Shortcuts | `~/Documents/Adobe/Premiere Pro/{ver}/Profile-{name}/Mac/` | `*.kys` |
| Workspaces | `~/Documents/Adobe/Premiere Pro/{ver}/Profile-{name}/Layouts/` | `*.xml` |
| Effects Presets | `~/Documents/Adobe/Premiere Pro/{ver}/Profile-{name}/` | `*.prfpset` |
| Export Presets | `~/Documents/Adobe/Adobe Media Encoder/{ver}/Presets/` | `*.xml`, `*.epr` |
| Motion Graphics Templates | `~/Library/Application Support/Adobe/Common/Motion Graphics Templates/` | `*.mogrt` |
| Excalibur Macros | `~/Library/Application Support/Knights of the Editing Table/` | `*.json` |
| Excalibur Scripts | `~/Documents/Knights of the Editing Table/Excalibur/Scripts/` | all files |

Sources are auto-discovered by `discoverSyncSources()` in `packages/launcher/src/main/index.ts`, which scans for installed Premiere Pro versions and profiles.

---

## Launcher Config

Stored by `ConfigStore` (`packages/launcher/src/main/config-store.ts`):

```
{
  syncSourcePath: string        // Path to shared sync folder
  machineId: string             // UUID — unique per machine
  machineName: string           // Hostname
  serverPort: number            // Default: 9876
  autoLaunchOnLogin: boolean
  startMinimized: boolean
  anthropicApiKey: string
  sourceRepoPath: string
  supabaseUrl: string           // Supabase project URL
  supabaseAnonKey: string       // Supabase anon key
  autoUpdate: boolean
  ghToken: string
}
```

---

## Initialization Order

1. Load launcher config
2. Discover Premiere Pro sync sources via `discoverSyncSources()`
3. Register all sources with SyncEngine
4. Start PresetSyncService (bidirectional, every 30s)
5. Start StreamDeckSyncService (bidirectional, every 30s)
6. Start SupabaseSyncService (push analytics, pull models)
