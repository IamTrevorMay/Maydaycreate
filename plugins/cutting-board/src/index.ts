import { definePlugin } from '@mayday/sdk';
import type { PluginContext, Sequence } from '@mayday/sdk';
import { createSnapshot, diffSnapshots, checkForUndo } from './diff.js';
import { CuttingBoardDB } from './db.js';
import { extractFeatures, toJSONL, formatForPrompt } from './pipeline.js';
import { ExampleBank } from './example-bank.js';
import type { TimelineSnapshot, EditChange } from './types.js';

const POLL_INTERVAL = 500;
const SNAPSHOT_RING_SIZE = 20;

let db: CuttingBoardDB | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let currentSessionId: number | null = null;
let previousSnapshot: TimelineSnapshot | null = null;
let snapshotHistory: TimelineSnapshot[] = [];
let editCount = 0;
let eventSubs: Array<{ unsubscribe(): void }> = [];

// Dedupe edits across poll cycles (linked audio+video arrive separately)
const recentEdits = new Map<string, number>(); // dedupeKey → timestamp
const DEDUPE_WINDOW = 2000; // 2 seconds

function isDuplicate(change: EditChange): boolean {
  const timeKey = (Math.round(change.editPointTime * 10) / 10).toFixed(1);
  const key = `${change.editType}|${timeKey}`;
  const now = Date.now();

  // Clean old entries
  for (const [k, t] of recentEdits) {
    if (now - t > DEDUPE_WINDOW) recentEdits.delete(k);
  }

  if (recentEdits.has(key)) return true;
  recentEdits.set(key, now);
  return false;
}

function cleanup() {
  for (const sub of eventSubs) sub.unsubscribe();
  eventSubs = [];
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  previousSnapshot = null;
  snapshotHistory = [];
  currentSessionId = null;
  editCount = 0;
}

let pollCount = 0;

async function pollTimeline(ctx: PluginContext) {
  try {
    const seq = await ctx.services.timeline.getActiveSequence();
    if (!seq) {
      ctx.log.warn('Poll: no active sequence');
      return;
    }

    const totalClips = seq.videoTracks.reduce((n, t) => n + t.clips.length, 0)
      + seq.audioTracks.reduce((n, t) => n + t.clips.length, 0);

    const snapshot = createSnapshot(seq);

    if (!previousSnapshot) {
      ctx.log.info(`Poll: first snapshot, ${totalClips} clips, hash=${snapshot.hash.slice(0, 8)}`);
      previousSnapshot = snapshot;
      snapshotHistory.push(snapshot);
      return;
    }

    // Log every 20th poll to show it's alive
    pollCount++;
    if (pollCount % 20 === 0) {
      ctx.log.debug(`Poll #${pollCount}: ${totalClips} clips, hash=${snapshot.hash.slice(0, 8)} (prev=${previousSnapshot.hash.slice(0, 8)})`);
    }

    // Skip if nothing changed
    if (snapshot.hash === previousSnapshot.hash) return;

    ctx.log.info(`Poll: hash changed! ${previousSnapshot.hash.slice(0, 8)} -> ${snapshot.hash.slice(0, 8)}, ${totalClips} clips`);

    // Check for undo
    const isUndo = checkForUndo(snapshot, snapshotHistory);

    // Diff against previous snapshot
    const changes = diffSnapshots(previousSnapshot, snapshot);

    // Debug: log group sizes to understand why diff might miss
    if (changes.length === 0) {
      const prevByKey = new Map<string, number>();
      const currByKey = new Map<string, number>();
      for (const c of previousSnapshot.clips) prevByKey.set(c.key, (prevByKey.get(c.key) || 0) + 1);
      for (const c of snapshot.clips) currByKey.set(c.key, (currByKey.get(c.key) || 0) + 1);
      const diffs: string[] = [];
      const allKeys = new Set([...prevByKey.keys(), ...currByKey.keys()]);
      for (const k of allKeys) {
        const p = prevByKey.get(k) || 0;
        const c = currByKey.get(k) || 0;
        if (p !== c) diffs.push(`"${k.split('|')[0].slice(0, 30)}": ${p}->${c}`);
      }
      ctx.log.warn(`Diff returned 0 changes despite hash change. Group diffs: ${diffs.join(', ') || 'none'}`);
    }

    if (changes.length > 0 && currentSessionId != null && db) {
      for (const change of changes) {
        // Skip duplicates from linked audio+video arriving in separate polls
        if (isDuplicate(change)) {
          ctx.log.debug(`Skipping duplicate: ${change.editType} at ${change.editPointTime.toFixed(2)}`);
          continue;
        }

        if (isUndo) change.isUndo = true;

        const now = Date.now();
        const recordId = db.insertRecord({
          sessionId: currentSessionId,
          editType: change.editType,
          editPointTime: change.editPointTime,
          clipName: change.clipName,
          mediaPath: change.mediaPath,
          trackIndex: change.trackIndex,
          trackType: change.trackType,
          beforeState: JSON.stringify(change.beforeState),
          afterState: JSON.stringify(change.afterState),
          audioCategory: null,
          rating: isUndo ? 0 : 1,
          voiceTranscript: null,
          notes: null,
          isUndo: change.isUndo,
          detectedAt: now,
          feedbackAt: now,
        });

        // Undo: also flip the previous non-undo edit to thumbs down
        if (isUndo) {
          db.markPreviousEditAsDown(currentSessionId, recordId);
        }

        editCount++;

        ctx.log.info(`Edit detected: ${change.editType} on "${change.clipName}" at ${change.editPointTime.toFixed(2)}s${isUndo ? ' (undo)' : ''}`);

        // Push notification to panel (auto-rated, no manual input needed)
        ctx.ui.pushToPanel('feedback-request', {
          recordId,
          editType: change.editType,
          clipName: change.clipName,
          editPointTime: change.editPointTime,
          trackType: change.trackType,
          isUndo: change.isUndo,
        });
      }
    }

    // Update ring buffer
    snapshotHistory.push(snapshot);
    if (snapshotHistory.length > SNAPSHOT_RING_SIZE) {
      snapshotHistory.shift();
    }
    previousSnapshot = snapshot;
  } catch (err) {
    ctx.log.error('Poll error:', err);
  }
}

export default definePlugin({
  async activate(ctx) {
    db = new CuttingBoardDB(ctx.dataDir);

    // Listen for boost requests from panel/hotkey
    eventSubs.push(ctx.onEvent('plugin:cutting-board:boost', (data) => {
      const { recordId } = data as { recordId: number };
      if (db) {
        db.boostRecord(recordId);
        ctx.log.info(`Boosted record ${recordId}`);
      }
    }));

    ctx.log.info('Cutting Board activated');
  },

  async deactivate(ctx) {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (currentSessionId != null && db) {
      db.endSession(currentSessionId, editCount);
    }
    for (const sub of eventSubs) sub.unsubscribe();
    eventSubs = [];
    db?.close();
    db = null;
    previousSnapshot = null;
    snapshotHistory = [];
    currentSessionId = null;
    editCount = 0;
    ctx.log.info('Cutting Board deactivated');
  },

  commands: {
    'start-capture': async (ctx) => {
      if (pollTimer) {
        ctx.ui.showToast('Already capturing', 'warning');
        return { capturing: true };
      }

      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast('No active sequence — open a sequence first', 'warning');
        return null;
      }

      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }

      // Create session
      currentSessionId = db.createSession(seq.sequenceId, seq.name);
      editCount = 0;
      previousSnapshot = null;
      snapshotHistory = [];

      // Start polling
      pollTimer = setInterval(() => pollTimeline(ctx), POLL_INTERVAL);

      ctx.log.info(`Capturing edits on "${seq.name}" (session ${currentSessionId})`);
      ctx.ui.showToast(`Capturing edits on "${seq.name}"`, 'success');

      // Listen for feedback responses from panel
      // (handled via EventBus in the server — the plugin receives these through
      //  the server's message routing)

      return { sessionId: currentSessionId, sequence: seq.name };
    },

    'stop-capture': async (ctx) => {
      if (!pollTimer || currentSessionId == null) {
        ctx.ui.showToast('Not currently capturing', 'warning');
        return null;
      }

      clearInterval(pollTimer);
      pollTimer = null;

      if (db) {
        db.endSession(currentSessionId, editCount);
        const stats = db.getSessionStats(currentSessionId);

        const typeSummary = Object.entries(stats.editsByType)
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');

        const msg = `Session ended: ${stats.totalEdits} edits (${typeSummary})${stats.approvalRate != null ? `, ${(stats.approvalRate * 100).toFixed(0)}% approval` : ''}`;
        ctx.log.info(msg);
        ctx.ui.showToast(msg, 'info');

        const sessionId = currentSessionId;
        currentSessionId = null;
        previousSnapshot = null;
        snapshotHistory = [];
        editCount = 0;

        return stats;
      }

      cleanup();
      return null;
    },

    stats: async (ctx) => {
      if (!db || currentSessionId == null) {
        ctx.ui.showToast('No active session', 'warning');
        return null;
      }

      const stats = db.getSessionStats(currentSessionId);
      const msg = `Edits: ${stats.totalEdits} | \u{1F44D} ${stats.thumbsUp} | \u{1F44E} ${stats.thumbsDown} | Undos: ${stats.undoCount}${stats.approvalRate != null ? ` | ${(stats.approvalRate * 100).toFixed(0)}%` : ''}`;
      ctx.ui.showToast(msg, 'info');
      return stats;
    },

    'training-stats': async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      return db.getAggregateStats();
    },

    'export-training': async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }

      const records = db.getQualityRecords();
      if (records.length === 0) {
        ctx.ui.showToast('No training data available', 'warning');
        return null;
      }

      const examples = records.map(r => extractFeatures(r));
      const jsonl = toJSONL(examples);
      const exportPath = (await import('path')).join(ctx.dataDir, `training-${Date.now()}.jsonl`);
      (await import('fs')).writeFileSync(exportPath, jsonl);

      const bank = new ExampleBank();
      bank.load(records);
      const dist = bank.getDistribution();

      ctx.ui.showToast(`Exported ${examples.length} training examples`, 'success');
      ctx.log.info(`Training data exported to ${exportPath}`);

      return {
        path: exportPath,
        count: examples.length,
        distribution: dist,
        promptPreview: formatForPrompt(examples, 5),
      };
    },

    'export-data': async (ctx) => {
      if (!db) {
        ctx.ui.showToast('No data available', 'warning');
        return null;
      }

      const data = db.exportAllRecords();
      const exportPath = (await import('path')).join(ctx.dataDir, `export-${Date.now()}.json`);
      (await import('fs')).writeFileSync(exportPath, JSON.stringify(data, null, 2));

      ctx.ui.showToast(`Exported ${data.records.length} records to ${exportPath}`, 'success');
      ctx.log.info(`Exported data to ${exportPath}`);
      return { path: exportPath, sessions: data.sessions.length, records: data.records.length };
    },

    'sync-data': async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      const sessions = db.getUnsyncedSessions();
      const records = db.getUnsyncedRecords(500);
      return { sessions, records };
    },

    'mark-synced': async (ctx, args) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      const { table, ids } = args as { table: 'sessions' | 'cut_records'; ids: number[] };
      db.markSynced(table, ids);
      return { marked: ids.length };
    },
  },
});
