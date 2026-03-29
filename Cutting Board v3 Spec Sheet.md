# Cutting Board v3 Spec Sheet

## Context
The Cutting Board page is a single 1100-line monolithic component with three sections stacked vertically. We're splitting it into three intuitive sub-pages (tabs) with a fun training animation. Goal: a user should understand the data pipeline just by looking at it.

---

# PHASE 1: Backend Foundation (CONFIRMED)
*No UI changes. Adds the data layer needed by all subsequent phases. 5 files touched.*

## Step 1.1 — Add Types

**File:** `packages/types/src/cutting-board.ts`
**Action:** Append two new interfaces after the existing `CuttingBoardTrainingRun` (line 38)

```typescript
export interface CuttingBoardSession {
  id: number;
  sequenceId: string;
  sequenceName: string;
  sessionName: string | null;
  videoId: string | null;
  startedAt: number;
  endedAt: number | null;
  totalEdits: number;
  cutCount: number;          // edits where edit_type = 'cut'
  taggedCount: number;       // edits with intent_tags != '[]'
}

export interface CuttingBoardTrainingDataSummary {
  totalRecords: number;       // all non-undo cut records
  ratedCount: number;         // records with rating != null
  unratedCount: number;       // records with rating = null
  taggedCount: number;        // records with intent_tags != '[]'
  untaggedCount: number;      // records with intent_tags = '[]' or null
  boostedCount: number;       // records with boosted = 1
  badCount: number;           // records with rating = 0
}
```

**No changes needed to the types index** — `packages/types/src/index.ts` already has `export * from './cutting-board.js'` (line 10), so both new interfaces are auto-exported.

---

## Step 1.2 — Add Database Methods

**File:** `plugins/cutting-board/src/db.ts`
**Action:** Add 3 new methods to the `CuttingBoardDB` class, before the `close()` method (line 488)

### `getAllSessions()`

```typescript
getAllSessions(): Array<{
  id: number;
  sequenceId: string;
  sequenceName: string;
  sessionName: string | null;
  videoId: string | null;
  startedAt: number;
  endedAt: number | null;
  totalEdits: number;
  cutCount: number;
  taggedCount: number;
}> {
  return this.db.prepare(`
    SELECT
      s.id,
      s.sequence_id AS sequenceId,
      s.sequence_name AS sequenceName,
      s.session_name AS sessionName,
      s.video_id AS videoId,
      s.started_at AS startedAt,
      s.ended_at AS endedAt,
      s.total_edits AS totalEdits,
      COALESCE((SELECT COUNT(*) FROM cut_records cr
        WHERE cr.session_id = s.id AND cr.edit_type = 'cut'), 0) AS cutCount,
      COALESCE((SELECT COUNT(*) FROM cut_records cr
        WHERE cr.session_id = s.id AND cr.intent_tags IS NOT NULL
        AND cr.intent_tags != '[]'), 0) AS taggedCount
    FROM sessions s
    ORDER BY s.started_at DESC
  `).all() as Array<{
    id: number; sequenceId: string; sequenceName: string;
    sessionName: string | null; videoId: string | null;
    startedAt: number; endedAt: number | null; totalEdits: number;
    cutCount: number; taggedCount: number;
  }>;
}
```

### `deleteSession(sessionId)`

```typescript
deleteSession(sessionId: number): void {
  this.db.prepare('DELETE FROM cut_records WHERE session_id = ?').run(sessionId);
  this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}
```

### `getTrainingDataSummary()`

```typescript
getTrainingDataSummary(): {
  totalRecords: number;
  ratedCount: number;
  unratedCount: number;
  taggedCount: number;
  untaggedCount: number;
  boostedCount: number;
  badCount: number;
} {
  const total = (this.db.prepare(
    'SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0'
  ).get() as { c: number }).c;

  const unrated = (this.db.prepare(
    'SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND rating IS NULL'
  ).get() as { c: number }).c;

  const untagged = (this.db.prepare(
    "SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND (intent_tags IS NULL OR intent_tags = '[]')"
  ).get() as { c: number }).c;

  const boosted = (this.db.prepare(
    'SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND boosted = 1'
  ).get() as { c: number }).c;

  const bad = (this.db.prepare(
    'SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND rating = 0'
  ).get() as { c: number }).c;

  return {
    totalRecords: total,
    ratedCount: total - unrated,
    unratedCount: unrated,
    taggedCount: total - untagged,
    untaggedCount: untagged,
    boostedCount: boosted,
    badCount: bad,
  };
}
```

---

## Step 1.3 — Add Plugin Commands

**File:** `plugins/cutting-board/src/index.ts`
**Action:** Add 3 new commands in the `commands` object, after the existing `'unnamed-sessions'` command (line 459)

Each follows the exact same pattern as `'name-session'` (line 444) — init db if null, call db method, return result.

### `'all-sessions'`
```typescript
'all-sessions': async (ctx) => {
  if (!db) db = new CuttingBoardDB(ctx.dataDir);
  return db.getAllSessions();
},
```

### `'delete-session'`
```typescript
'delete-session': async (ctx, args) => {
  if (!db) db = new CuttingBoardDB(ctx.dataDir);
  const { sessionId } = args as { sessionId: number };
  db.deleteSession(sessionId);
  ctx.log.info(`Session ${sessionId} deleted`);
  return { deleted: true, sessionId };
},
```

### `'training-data-summary'`
```typescript
'training-data-summary': async (ctx) => {
  if (!db) db = new CuttingBoardDB(ctx.dataDir);
  return db.getTrainingDataSummary();
},
```

---

## Step 1.4 — Add IPC Handlers

**File:** `packages/launcher/src/main/cutting-board-ipc.ts`
**Action:** Add 4 new `ipcMain.handle()` calls inside `registerCuttingBoardHandlers()`, after the existing `cuttingBoard:listDatasets` handler (~line 684)

All follow the same pattern: POST to `http://localhost:{port}/api/plugins/cutting-board/command/{cmd-name}` with JSON body. Read-only handlers get local SQLite fallbacks matching the existing `getAggregateStatsLocal()` pattern (lines 37-109). Write handlers go through server plugin only.

### `cuttingBoard:getAllSessions`
```typescript
ipcMain.handle('cuttingBoard:getAllSessions', async () => {
  // Try server plugin API first
  try {
    const config = loadConfig();
    const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/all-sessions`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (data.success) return data.result;
    }
  } catch {}

  // Fall back to direct SQLite read
  const db = openDb();
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT s.id, s.sequence_id AS sequenceId, s.sequence_name AS sequenceName,
             s.session_name AS sessionName, s.video_id AS videoId,
             s.started_at AS startedAt, s.ended_at AS endedAt, s.total_edits AS totalEdits,
             COALESCE((SELECT COUNT(*) FROM cut_records cr
               WHERE cr.session_id = s.id AND cr.edit_type = 'cut'), 0) AS cutCount,
             COALESCE((SELECT COUNT(*) FROM cut_records cr
               WHERE cr.session_id = s.id AND cr.intent_tags IS NOT NULL
               AND cr.intent_tags != '[]'), 0) AS taggedCount
      FROM sessions s ORDER BY s.started_at DESC
    `).all();
  } finally {
    db.close();
  }
});
```

### `cuttingBoard:deleteSession`
```typescript
ipcMain.handle('cuttingBoard:deleteSession', async (_e, sessionId: number) => {
  const config = loadConfig();
  const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/delete-session`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error(`Failed to delete session ${sessionId}`);
  const data = await res.json();
  return data.success ? data.result : null;
});
```

### `cuttingBoard:nameSession`
```typescript
ipcMain.handle('cuttingBoard:nameSession', async (_e, sessionId: number, sessionName: string) => {
  const config = loadConfig();
  const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/name-session`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, sessionName }),
  });
  if (!res.ok) throw new Error(`Failed to rename session ${sessionId}`);
  const data = await res.json();
  return data.success ? data.result : null;
});
```

### `cuttingBoard:getTrainingDataSummary`
```typescript
ipcMain.handle('cuttingBoard:getTrainingDataSummary', async () => {
  // Try server plugin API first
  try {
    const config = loadConfig();
    const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/training-data-summary`;
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      if (data.success) return data.result;
    }
  } catch {}

  // Fall back to direct SQLite read
  const db = openDb();
  if (!db) return null;
  try {
    const total = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0').get() as { c: number }).c;
    const unrated = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND rating IS NULL').get() as { c: number }).c;
    const untagged = (db.prepare("SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND (intent_tags IS NULL OR intent_tags = '[]')").get() as { c: number }).c;
    const boosted = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND boosted = 1').get() as { c: number }).c;
    const bad = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 0 AND rating = 0').get() as { c: number }).c;
    return {
      totalRecords: total,
      ratedCount: total - unrated,
      unratedCount: unrated,
      taggedCount: total - untagged,
      untaggedCount: untagged,
      boostedCount: boosted,
      badCount: bad,
    };
  } finally {
    db.close();
  }
});
```

---

## Step 1.5 — Extend Preload Bridge

**File:** `packages/launcher/src/preload/index.ts`
**Action:** Add 4 new methods to the `cuttingBoard` object (after `listDatasets` on line 164)

```typescript
getAllSessions: (): Promise<CuttingBoardSession[]> =>
  ipcRenderer.invoke('cuttingBoard:getAllSessions'),
deleteSession: (sessionId: number): Promise<{ deleted: boolean; sessionId: number } | null> =>
  ipcRenderer.invoke('cuttingBoard:deleteSession', sessionId),
nameSession: (sessionId: number, sessionName: string): Promise<unknown> =>
  ipcRenderer.invoke('cuttingBoard:nameSession', sessionId, sessionName),
getTrainingDataSummary: (): Promise<CuttingBoardTrainingDataSummary | null> =>
  ipcRenderer.invoke('cuttingBoard:getTrainingDataSummary'),
```

Also add to the import at the top of the file:
```typescript
import type { CuttingBoardSession, CuttingBoardTrainingDataSummary } from '@mayday/types';
```

---

## Step 1.6 — Verification

1. Build the server: `npm run build --workspace=packages/server`
2. Kill existing app: `pkill -f "Mayday Create"; pkill -f electron`
3. Start dev: `npm run dev --workspace=packages/launcher`
4. Open Electron DevTools (Cmd+Opt+I)
5. Test each new endpoint in console:

```javascript
await window.api.cuttingBoard.getAllSessions()
await window.api.cuttingBoard.getTrainingDataSummary()
await window.api.cuttingBoard.nameSession(1, "Test Name")
await window.api.cuttingBoard.deleteSession(99)
```

6. Confirm no console errors in the main process terminal output
7. Confirm existing Cutting Board page still works normally (no regressions)

---

# PHASE 2: Extract Shared Components (CONFIRMED)
*Moves reusable pieces out of the monolith before restructuring. 1 new file, 1 modified file. Zero visual changes.*

## Step 2.1 — Create Shared Components File

**New file:** `packages/launcher/src/renderer/components/cutting-board/shared.tsx`

Extract from `CuttingBoardPage.tsx`:

| Component/Export | Current Location | What it does |
|---|---|---|
| `Section` | lines 1075-1088 | Card wrapper with title + border |
| `StatCard` | lines 1051-1064 | Big number + label (used in stat grids) |
| `MiniStat` | lines 1066-1073 | Compact number + label (used in model training) |
| `TrainingProgress` | lines 1090-1121 | Animated progress bar for training |
| `formatTimecode()` | lines 1123-1127 | Formats seconds to `M:SS.s` |
| `formatRelativeTime()` | lines 1129-1138 | Formats timestamp to "2h ago" etc. |
| `EDIT_TYPE_COLORS` | lines 8-15 | Color map for cut/trim/delete/move/add |
| `CONFIDENCE_COLORS` | lines 17-21 | Color map for high/medium/low |

Also re-exports `INTENT_TAGS` from `@mayday/types` for convenience.

```typescript
import React from 'react';
import { c } from '../../styles.js';
export { INTENT_TAGS } from '@mayday/types';

export const EDIT_TYPE_COLORS: Record<string, string> = {
  cut: '#2680eb',
  'trim-head': '#a855f7',
  'trim-tail': '#ec4899',
  delete: '#f87171',
  move: '#fbbf24',
  add: '#4ade80',
};

export const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4ade80',
  medium: '#fbbf24',
  low: '#f87171',
};

// StatCard, MiniStat, Section, TrainingProgress — exact same code, just exported
// formatTimecode, formatRelativeTime — exact same code, just exported
```

---

## Step 2.2 — Update CuttingBoardPage.tsx Imports

**File:** `packages/launcher/src/renderer/pages/CuttingBoardPage.tsx`

- Delete local definitions of `EDIT_TYPE_COLORS`, `CONFIDENCE_COLORS`, `StatCard`, `MiniStat`, `Section`, `TrainingProgress`, `formatTimecode`, `formatRelativeTime` (lines 8-21 and 1051-1138)
- Replace `import { INTENT_TAGS } from '@mayday/types'` (line 5) with import from shared
- Add:

```typescript
import {
  EDIT_TYPE_COLORS,
  CONFIDENCE_COLORS,
  Section,
  StatCard,
  MiniStat,
  TrainingProgress,
  formatTimecode,
  formatRelativeTime,
  INTENT_TAGS,
} from '../components/cutting-board/shared.js';
```

File shrinks by ~100 lines but renders identically.

---

## Step 2.3 — Verification

1. `npm run dev --workspace=packages/launcher`
2. Navigate to Cutting Board page
3. Confirm all sections render identically: Cut Finder, Join Models, Cut Watcher stats, training history, stat cards, progress bar
4. No console errors
5. All interactive elements still work (analyze, join, train)

---

# PHASE 3: Tab Shell + Cut Finder Tab (CONFIRMED)
*Restructures the page into 3 tabs. Cut Finder moves as-is with zero logic changes. 1 new file, 1 rewritten file.*

## Step 3.1 — Create Cut Finder Tab

**New file:** `packages/launcher/src/renderer/components/cutting-board/CutFinderTab.tsx`

Move 3 components from `CuttingBoardPage.tsx` with no logic changes:

| Component | Current Lines | What it does |
|---|---|---|
| `CutFinderSection` | 50-295 | YouTube URL input, progress bar, analyses list, detected cuts |
| `JoinModelsSection` | 299-522 | Model A/B dropdowns, join button, confidence tier results |
| `CutRow` | 526-751 | Expandable cut row with before/after frames + tag picker |

Imports:
```typescript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c } from '../../styles.js';
import { useIpc } from '../../hooks/useIpc.js';
import {
  Section,
  CONFIDENCE_COLORS,
  INTENT_TAGS,
  formatTimecode,
} from './shared.js';
import type { CutFinderAnalysisSummary, CutFinderProgress, DetectedCut, CuttingBoardJoinResult } from '@mayday/types';
```

Exported wrapper:
```typescript
export function CutFinderTab(): React.ReactElement {
  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <CutFinderSection />
      <JoinModelsSection />
    </div>
  );
}
```

`CutFinderSection`, `JoinModelsSection`, and `CutRow` remain as private functions inside this file — exact same code, just using shared imports.

---

## Step 3.2 — Rewrite Page Shell

**File:** `packages/launcher/src/renderer/pages/CuttingBoardPage.tsx`

Replace the entire 1100-line file with a ~50-line tab shell following the `YouTubePage.tsx` pattern (lines 12-18 for type/TABS, lines 137-162 for tab bar JSX):

```typescript
import React, { useState } from 'react';
import { c } from '../styles.js';
import { useCuttingBoard } from '../hooks/useCuttingBoard.js';
import { CutFinderTab } from '../components/cutting-board/CutFinderTab.js';
import {
  Section, StatCard, MiniStat, TrainingProgress,
  EDIT_TYPE_COLORS, INTENT_TAGS, formatRelativeTime,
} from '../components/cutting-board/shared.js';

type Tab = 'cut-watcher' | 'cut-finder' | 'training';

const TABS: { id: Tab; label: string }[] = [
  { id: 'cut-watcher', label: 'Cut Watcher' },
  { id: 'cut-finder', label: 'Cut Finder' },
  { id: 'training', label: 'Training' },
];

export function CuttingBoardPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('cut-watcher');
  const { stats, trainingRuns, training, trainModel, postTrainResult,
          merging, mergeResult, mergeError, cloudMergeTrain, dismissPostTrain } = useCuttingBoard();

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex',
        borderBottom: `1px solid ${c.border.default}`,
        padding: '0 20px',
        background: c.bg.secondary,
        flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: `2px solid ${tab === t.id ? c.accent.primary : 'transparent'}`,
              color: tab === t.id ? c.text.primary : c.text.secondary,
              fontSize: 12,
              fontWeight: tab === t.id ? 600 : 400,
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'cut-watcher' && (
        // Temporary: existing CutWatcherStats inline until Phase 4
      )}
      {tab === 'cut-finder' && <CutFinderTab />}
      {tab === 'training' && (
        // Placeholder until Phase 5
      )}
    </div>
  );
}
```

Existing `CutWatcherStats` (lines 755-1047) stays in `CuttingBoardPage.tsx` temporarily for the Cut Watcher tab — it moves out in Phase 4. Training tab gets a placeholder until Phase 5.

---

## Step 3.3 — Verification

1. `npm run dev --workspace=packages/launcher`
2. Navigate to Cutting Board page
3. Tab bar renders with 3 tabs: **Cut Watcher**, **Cut Finder**, **Training**
4. **Cut Finder tab**: YouTube URL input, analyses list, join models, cut tag picker — all identical to before
5. **Cut Watcher tab**: Shows existing stats/sessions/training (same CutWatcherStats component, just in a tab)
6. **Training tab**: Shows placeholder text
7. No console errors
8. Tab switching is instant, no state loss within each tab

---

# PHASE 4: Cut Watcher Tab (CONFIRMED)
*Session management with compact expandable rows. Replaces old flat stats view. 2 new files, 1 modified file, 1 modified hook.*

## Step 4.1 — Extend useCuttingBoard Hook

**File:** `packages/launcher/src/renderer/hooks/useCuttingBoard.ts`

Add to imports:
```typescript
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun, CuttingBoardSession, CuttingBoardTrainingDataSummary } from '@mayday/types';
```

Add state (after line 27):
```typescript
const [sessions, setSessions] = useState<CuttingBoardSession[]>([]);
const [trainingDataSummary, setTrainingDataSummary] = useState<CuttingBoardTrainingDataSummary | null>(null);
```

Extend `refresh` callback to also fetch sessions and training data summary:
```typescript
try {
  const sess = await ipc.cuttingBoard.getAllSessions();
  setSessions(sess);
} catch (err) {
  console.error('[CuttingBoard] getAllSessions error:', err);
}
try {
  const tds = await ipc.cuttingBoard.getTrainingDataSummary();
  setTrainingDataSummary(tds);
} catch (err) {
  console.error('[CuttingBoard] getTrainingDataSummary error:', err);
}
```

Add action functions:
```typescript
const deleteSession = useCallback(async (sessionId: number) => {
  await ipc.cuttingBoard.deleteSession(sessionId);
  await refresh();
}, [ipc, refresh]);

const nameSession = useCallback(async (sessionId: number, name: string) => {
  await ipc.cuttingBoard.nameSession(sessionId, name);
  await refresh();
}, [ipc, refresh]);
```

Extend return:
```typescript
return {
  stats, trainingRuns, training, trainModel, refresh,
  postTrainResult, merging, mergeResult, mergeError, cloudMergeTrain, dismissPostTrain,
  sessions, trainingDataSummary, deleteSession, nameSession,
};
```

---

## Step 4.2 — Create Session Row Component

**New file:** `packages/launcher/src/renderer/components/cutting-board/SessionRow.tsx`

```typescript
import React, { useState, useRef, useEffect } from 'react';
import { c } from '../../styles.js';
import { formatRelativeTime } from './shared.js';
import type { CuttingBoardSession } from '@mayday/types';

interface SessionRowProps {
  session: CuttingBoardSession;
  onDelete: (sessionId: number) => void;
  onRename: (sessionId: number, name: string) => void;
}
```

**Collapsed row (single line):**
- Name: `sessionName` bold, or `sequenceName` normal if unnamed
- Edits badge pill: `totalEdits`
- Cuts badge (blue pill): `cutCount`
- Tags badge (purple pill): `taggedCount`
- Date: `formatRelativeTime(startedAt)` — right-aligned, muted
- Live indicator: green pulsing dot + "Live" if `endedAt === null`
- Expand chevron (right arrow, rotates when expanded)
- Trash icon: hover-visible, calls `confirm()` then `onDelete()`, disabled if live

**Inline rename (double-click name):**
- Swaps span for auto-focused input, pre-filled with current name
- Enter saves via `onRename()`, Escape cancels

**Expanded state (click row to toggle):**
- Cut vs. other edits split bar (`cutCount` vs `totalEdits - cutCount`)
- Summary: total edits, cuts, tagged, duration (`endedAt - startedAt`)
- Video ID label if set

---

## Step 4.3 — Create Cut Watcher Tab

**New file:** `packages/launcher/src/renderer/components/cutting-board/CutWatcherTab.tsx`

```typescript
import React from 'react';
import { c } from '../../styles.js';
import { StatCard } from './shared.js';
import { SessionRow } from './SessionRow.js';
import type { CuttingBoardSession, CuttingBoardAggregateStats } from '@mayday/types';

interface CutWatcherTabProps {
  sessions: CuttingBoardSession[];
  stats: CuttingBoardAggregateStats | null;
  onDelete: (sessionId: number) => void;
  onRename: (sessionId: number, name: string) => void;
}
```

Layout:
- **Top**: 5 stat cards (Total Edits, Sessions, Approval, Tagged, Undo Rate) — same as existing lines 773-779
- **Below**: Scrollable `SessionRow` list
- **Empty state**: "No sessions yet. Start editing in Premiere Pro to capture your first session."

---

## Step 4.4 — Wire Into Page Shell

**File:** `packages/launcher/src/renderer/pages/CuttingBoardPage.tsx`

- Import `CutWatcherTab`
- Replace temporary Cut Watcher content:
```typescript
{tab === 'cut-watcher' && (
  <CutWatcherTab sessions={sessions} stats={stats} onDelete={deleteSession} onRename={nameSession} />
)}
```
- Remove old inline `CutWatcherStats` component (fully replaced)
- Destructure `sessions`, `deleteSession`, `nameSession` from `useCuttingBoard()`

---

## Step 4.5 — Verification

1. `npm run dev --workspace=packages/launcher`
2. Navigate to Cutting Board > Cut Watcher tab
3. Session list renders with name, edits, cuts, tagged counts, date
4. Live session shows green "Live" dot, delete disabled
5. Double-click rename works, persists after refresh
6. Delete shows confirm dialog, removes session
7. Expand shows summary stats (total edits, cuts, tagged, duration)
8. Empty state renders when no sessions exist
9. Stat cards show correct aggregate numbers
10. No console errors

---

# PHASE 5: Training Tab — Data Panels (CONFIRMED)
*Three-column layout with gym/workout theme. No monster animation yet. 3 new files, 1 modified page shell.*

## Step 5.1 — Create "Workout Queue" Panel (left side)

**New file:** `packages/launcher/src/renderer/components/cutting-board/WorkoutQueuePanel.tsx`

Represents data waiting to be trained on — reps waiting to be done.

```typescript
import React from 'react';
import { c } from '../../styles.js';
import type { CuttingBoardTrainingDataSummary } from '@mayday/types';

interface WorkoutQueuePanelProps {
  summary: CuttingBoardTrainingDataSummary | null;
}
```

Layout:
- **Header**: "Workout Queue" (bold, 13px)
- **Big number cards** (from `summary`):
  - `untaggedCount` — "untagged cuts" (purple accent)
  - `unratedCount` — "unrated cuts" (yellow accent)
  - `totalRecords` — "total reps available" (blue accent)
- **Derived stats row**: tagged, rated, boosted, marked bad
- **Minimum threshold**: If `totalRecords < 30`, progress bar + "Need {30 - N} more reps to start training"
- **Null state**: "Loading..." or "No data yet"

---

## Step 5.2 — Create "Personal Records" Panel (right side)

**New file:** `packages/launcher/src/renderer/components/cutting-board/PersonalRecordsPanel.tsx`

Represents training gains — a gym logbook of PRs.

```typescript
import React from 'react';
import { c } from '../../styles.js';
import { MiniStat, formatRelativeTime } from './shared.js';
import type { CuttingBoardTrainingRun } from '@mayday/types';

interface PersonalRecordsPanelProps {
  trainingRuns: CuttingBoardTrainingRun[];
}
```

Layout:
- **Header**: "Personal Records" (bold, 13px)
- **Latest model stats** (4-column `MiniStat` grid):
  - Version: `v{version}`
  - Accuracy: `{accuracy}%` (green >= 70%, yellow >= 50%, red below)
  - Training Size: `{trainingSize} reps`
  - Last Session: `formatRelativeTime(trainedAt)`
- **Training history table**: Version | Date | Reps | Accuracy
- **Empty state**: "No training sessions yet. Collect at least 30 reps, then hit the gym!"

---

## Step 5.3 — Create Training Tab

**New file:** `packages/launcher/src/renderer/components/cutting-board/TrainingTab.tsx`

```typescript
import React from 'react';
import { c } from '../../styles.js';
import { TrainingProgress } from './shared.js';
import { WorkoutQueuePanel } from './WorkoutQueuePanel.js';
import { PersonalRecordsPanel } from './PersonalRecordsPanel.js';
import type { CuttingBoardTrainingRun, CuttingBoardTrainingDataSummary } from '@mayday/types';
import type { LocalTrainResult, CloudMergeResult } from '../../hooks/useCuttingBoard.js';

interface TrainingTabProps {
  trainingDataSummary: CuttingBoardTrainingDataSummary | null;
  trainingRuns: CuttingBoardTrainingRun[];
  training: boolean;
  trainModel: () => void;
  postTrainResult: LocalTrainResult | null;
  merging: boolean;
  mergeResult: CloudMergeResult | null;
  mergeError: string;
  cloudMergeTrain: () => void;
  dismissPostTrain: () => void;
}
```

Three-column flexbox:
- Left (flex: 1): `WorkoutQueuePanel`
- Center (flex: 1.2): Monster placeholder (dashed circle, "Gym monster goes here") + train button + post-train flow (Keep Local / Push to Cloud, lifted from existing lines 890-1015)
- Right (flex: 1): `PersonalRecordsPanel`

Train button: "Start Workout" / "Working out..." (disabled if < 30 reps or currently training)

---

## Step 5.4 — Wire Into Page Shell

**File:** `packages/launcher/src/renderer/pages/CuttingBoardPage.tsx`

- Import `TrainingTab`
- Replace Training placeholder:
```typescript
{tab === 'training' && (
  <TrainingTab
    trainingDataSummary={trainingDataSummary}
    trainingRuns={trainingRuns}
    training={training}
    trainModel={trainModel}
    postTrainResult={postTrainResult}
    merging={merging}
    mergeResult={mergeResult}
    mergeError={mergeError}
    cloudMergeTrain={cloudMergeTrain}
    dismissPostTrain={dismissPostTrain}
  />
)}
```
- Destructure `trainingDataSummary` from `useCuttingBoard()`

---

## Step 5.5 — Verification

1. `npm run dev --workspace=packages/launcher`
2. Navigate to Cutting Board > Training tab
3. Three-column layout: Workout Queue, center placeholder, Personal Records
4. Left panel shows correct counts matching DB (untagged, unrated, total, tagged, rated, boosted, bad)
5. Left panel threshold: < 30 records shows progress bar + "Need N more reps"
6. Right panel shows latest model version/accuracy/size/date + history table
7. Right panel empty state shows gym-themed message
8. Train button ("Start Workout") works, triggers training, shows progress
9. Post-train flow (Keep Local / Push to Cloud) works
10. < 30 records disables train button
11. No console errors

---

# PHASE 6: Training Monster Animation (CONFIRMED)
*80s gym monster with jump rope. 2 new files, 1 modified file.*

## Step 6.1 — Create Monster Component

**New file:** `packages/launcher/src/renderer/components/cutting-board/TrainingMonster.tsx`

**SVG creature** (~150x150px): Purple/blue rounded blob with:
- Two large white eyes with black pupils
- Small curved mouth, tiny stub arms/legs
- **80s gym outfit** (SVG paths/rects):
  - Neon pink tank top with white trim
  - Bright blue gym shorts
  - Yellow sweatband on head + matching wristbands
  - White sneakers

**CSS keyframes** (injected via `<style>` in component):
- `monster-bob` — gentle translateY bounce, 2s ease infinite (idle)
- `monster-blink` — scaleY quick blink
- `jump-rope` — crouch → jump (translateY -20px) → land with squish → recover, 0.6s
- `rope-spin` — rope arc rotates 360deg, 0.6s linear (synced with jump)
- `tired-droop` — slower, lower jumps as energy depletes
- `monster-celebrate` — big bounce + fist pump + wobble
- `sparkle` — staggered scale/opacity pop
- `sweat-drop` — blue droplets from forehead, increase with tiredness

**Props:**
```typescript
interface TrainingMonsterProps {
  state: 'idle' | 'working-out' | 'celebrating';
  progress: number; // 0-100, tiredness level during workout
}
```

**Three states:**

**Idle:** Gentle bob, periodic blinks, big smile, arms at sides. Speech bubble: "Let's hit the gym!" (reps > 30) or "Need {N} more reps!" (< 30)

**Working Out (jump roping):** Tiredness progression driven by `progress` 0→100:
- 0-30%: Full energy — big jumps, wide smile, fast rope
- 30-60%: Getting tired — lower jumps, flat mouth, 1-2 sweat drops
- 60-85%: Tired — low jumps, frown, half-lidded eyes, 3-4 sweat drops, slower rope
- 85-100%: Exhausted — barely hopping, tongue out, eyes nearly closed, lots of sweat, wobbly rope

**Celebrating:** Arms-up victory pose, star eyes, sparkles, sweatband askew. Speech bubble: "New PR! v{N} — {accuracy}%". Returns to idle after 3s.

## Step 6.2 — Jump Rope Visual

Part of the monster SVG. Arc path connecting left hand → below feet → right hand.
- Neon green stroke, 2-3px, no fill
- Two `<path>` elements toggled by CSS timing to simulate rotation
- Only visible when `state === 'working-out'`

## Step 6.3 — Wire Monster Into Training Tab

**File:** `packages/launcher/src/renderer/components/cutting-board/TrainingTab.tsx`

```typescript
const [monsterState, setMonsterState] = useState<'idle' | 'working-out' | 'celebrating'>('idle');
const [workoutProgress, setWorkoutProgress] = useState(0);

// On "Start Workout":
setMonsterState('working-out'); setWorkoutProgress(0); trainModel();

// Animate progress during training (fake since async):
useEffect(() => {
  if (!training) {
    if (monsterState === 'working-out') {
      setMonsterState('celebrating');
      setTimeout(() => setMonsterState('idle'), 3000);
    }
    return;
  }
  const interval = setInterval(() => {
    setWorkoutProgress(prev => Math.min(95, prev + (prev < 50 ? 4 : prev < 80 ? 2 : 0.5)));
  }, 200);
  return () => clearInterval(interval);
}, [training, monsterState]);
```

Replace placeholder with `<TrainingMonster state={monsterState} progress={workoutProgress} />`. Pass `postTrainResult` accuracy/version for celebration bubble.

## Step 6.4 — Animate Panel Numbers During Training

- Left panel: animate `totalRecords` downward (lerp toward 0) to simulate reps being done
- Right panel: animate training size upward (lerp toward new count)
- `setInterval(50ms)` or `requestAnimationFrame` for smooth interpolation
- On complete: snap to real values from fresh `refresh()`
- Panels accept optional `overrideTotal?: number` prop

## Step 6.5 — Verification

1. Monster displays in 80s gym gear (tank top, shorts, sweatbands, sneakers)
2. Idle: gentle bob, blinks, speech bubble
3. Click "Start Workout": jump roping starts, rope spins, body jumps
4. 0-30%: fast jumps, big smile, full energy
5. 30-60%: slightly slower, sweat drops appear
6. 60-85%: half-lidded eyes, frown, more sweat, slower rope
7. 85-100%: barely hopping, tongue out, exhausted, wobbly rope
8. Complete: celebrates (arms up, star eyes, sparkles, "New PR!")
9. After 3s returns to idle
10. Panel numbers animate during training
11. Post-train flow still works
12. No console errors

---

# PHASE 7: Polish & Edge Cases (CONFIRMED)
*Final hardening pass. No new architecture, no new files. Touches multiple existing files.*

## Step 7.1 — Empty States

**Cut Watcher tab**: 0 sessions → "No sessions yet. Start editing in Premiere Pro to capture your first session." (already in Phase 4)

**Cut Finder tab**: Already has empty state — no change needed.

**Training tab**:
- 0 data, 0 runs: Monster bored/droopy idle (flat mouth, half-closed eyes). Speech bubble: "I need data to train! Edit in Premiere to give me reps."
- Data < 30 reps: Monster eager but can't start. Speech bubble: "Need {30-N} more reps!" + progress bar in Workout Queue.
- Data > 30, no model: Monster pumped. "Let's hit the gym!" + Start Workout enabled.

## Step 7.2 — Active Session Indicator

**File:** `SessionRow.tsx`
- `endedAt === null` → green pulsing dot + "Live" badge next to name
- Pulsing: `@keyframes pulse-dot` opacity 1 → 0.3 → 1, 1.5s infinite
- Delete blocked: trash grayed out, no click handler
- Live session naturally at top (sorted by `startedAt DESC`)

## Step 7.3 — Tab Persistence

**File:** `CuttingBoardPage.tsx`
- Store active tab in `localStorage` key `'cuttingBoard:activeTab'`
- Read on mount, write on change:
```typescript
const [tab, setTab] = useState<Tab>(() => {
  const saved = localStorage.getItem('cuttingBoard:activeTab');
  return (saved === 'cut-watcher' || saved === 'cut-finder' || saved === 'training') ? saved : 'cut-watcher';
});
const changeTab = (t: Tab) => { setTab(t); localStorage.setItem('cuttingBoard:activeTab', t); };
```

## Step 7.4 — Loading States

- **Session list**: 3-4 skeleton shimmer rows on first render (before data arrives)
- **Delete/rename**: Inline spinner on affected row. `SessionRow` accepts `loading?: boolean`, `CutWatcherTab` tracks `pendingOp: number | null`
- **Training panels**: "Loading..." while `trainingDataSummary` / `trainingRuns` are null on first fetch

## Step 7.5 — Input Validation

- **Rename**: Empty/whitespace → cancel, revert. Same as current → cancel without API call.
- **Delete live session**: Blocked in UI (Step 7.2). Backend `deleteSession` also checks `endedAt`.

## Step 7.6 — Final Cleanup

- `CuttingBoardPage.tsx` should be ~30-50 lines (imports + tab shell)
- Remove all dead code from original monolith
- Verify no duplicate component definitions
- All `import type` correct, no unused imports, no `any` types
- Verify all `shared.tsx` exports are consumed

## Step 7.7 — Verification

1. 0 sessions: skeleton → empty state
2. 1 live session: green pulsing "Live", delete disabled
3. 50+ sessions: smooth scrolling
4. 0 training data: monster bored, "I need data to train!"
5. 15 records: progress bar, "Need 15 more reps!", Start Workout disabled
6. 100+ records: normal flow
7. Delete live session: blocked
8. Tab switch during training: animation persists
9. Rename empty string: cancels
10. Rename same name: no API call
11. Tab persistence: survives navigation
12. Loading spinners on delete/rename
13. Build server + restart — no console errors
14. All three tabs fully functional end-to-end
