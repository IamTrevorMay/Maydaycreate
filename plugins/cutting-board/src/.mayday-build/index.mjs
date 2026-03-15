// ../sdk/dist/index.js
function definePlugin(definition) {
  if (typeof definition.activate !== "function") {
    throw new Error("Plugin must define an activate() function");
  }
  if (definition.commands) {
    for (const [id, handler] of Object.entries(definition.commands)) {
      if (typeof handler !== "function") {
        throw new Error(`Command "${id}" must be a function`);
      }
    }
  }
  return definition;
}

// ../../plugins/cutting-board/src/diff.ts
import { createHash } from "crypto";
var TOL = 0.01;
function roundTime(t) {
  return Math.round(t * 1e6) / 1e6;
}
function makeKey(clip) {
  return `${clip.name}|${clip.mediaPath}|${clip.trackIndex}|${clip.trackType}`;
}
function clipToFingerprint(clip) {
  return {
    key: makeKey(clip),
    name: clip.name,
    mediaPath: clip.mediaPath,
    trackIndex: clip.trackIndex,
    trackType: clip.trackType,
    start: roundTime(clip.start),
    end: roundTime(clip.end),
    duration: roundTime(clip.duration),
    inPoint: roundTime(clip.inPoint),
    outPoint: roundTime(clip.outPoint)
  };
}
function hashFingerprints(clips) {
  const data = clips.map((c) => `${c.key}:${c.start.toFixed(3)}:${c.end.toFixed(3)}:${c.inPoint.toFixed(3)}:${c.outPoint.toFixed(3)}`).join("\n");
  return createHash("md5").update(data).digest("hex");
}
function createSnapshot(seq) {
  const clips = [];
  for (const track of seq.videoTracks) {
    for (const clip of track.clips) clips.push(clipToFingerprint(clip));
  }
  for (const track of seq.audioTracks) {
    for (const clip of track.clips) clips.push(clipToFingerprint(clip));
  }
  clips.sort((a, b) => {
    if (a.trackType !== b.trackType) return a.trackType < b.trackType ? -1 : 1;
    if (a.trackIndex !== b.trackIndex) return a.trackIndex - b.trackIndex;
    if (a.start !== b.start) return a.start - b.start;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return {
    sequenceId: seq.sequenceId,
    sequenceName: seq.name,
    timestamp: Date.now(),
    clips,
    hash: hashFingerprints(clips)
  };
}
function near(a, b) {
  return Math.abs(a - b) < TOL;
}
function diffSnapshots(prev, curr) {
  const changes = [];
  const prevByKey = groupByKey(prev.clips);
  const currByKey = groupByKey(curr.clips);
  const allKeys = /* @__PURE__ */ new Set([...prevByKey.keys(), ...currByKey.keys()]);
  for (const key of allKeys) {
    const prevClips = prevByKey.get(key) || [];
    const currClips = currByKey.get(key) || [];
    if (prevClips.length === 0 && currClips.length > 0) {
      for (const clip of currClips) changes.push(makeChange("add", clip.start, clip, null, clip));
      continue;
    }
    if (prevClips.length > 0 && currClips.length === 0) {
      for (const clip of prevClips) changes.push(makeChange("delete", clip.start, clip, clip, null));
      continue;
    }
    let remaining_prev = [...prevClips];
    let remaining_curr = [...currClips];
    const cutPrev = /* @__PURE__ */ new Set();
    const cutCurr = /* @__PURE__ */ new Set();
    for (const pc of remaining_prev) {
      const candidates = remaining_curr.filter((cc) => !cutCurr.has(cc));
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          const a = candidates[i];
          const b = candidates[j];
          const first = a.start < b.start ? a : b;
          const second = a.start < b.start ? b : a;
          if (near(first.start, pc.start) && near(second.end, pc.end) && near(first.end, second.start)) {
            changes.push({
              editType: "cut",
              editPointTime: first.end,
              clipName: pc.name,
              mediaPath: pc.mediaPath,
              trackIndex: pc.trackIndex,
              trackType: pc.trackType,
              beforeState: pc,
              afterState: [first, second],
              isUndo: false
            });
            cutPrev.add(pc);
            cutCurr.add(a);
            cutCurr.add(b);
          }
        }
        if (cutPrev.has(pc)) break;
      }
    }
    remaining_prev = remaining_prev.filter((c) => !cutPrev.has(c));
    remaining_curr = remaining_curr.filter((c) => !cutCurr.has(c));
    remaining_prev = matchPass(
      remaining_prev,
      remaining_curr,
      changes,
      (pc, cc) => near(pc.inPoint, cc.inPoint) && near(pc.outPoint, cc.outPoint)
    );
    remaining_prev = matchPass(
      remaining_prev,
      remaining_curr,
      changes,
      (pc, cc) => near(pc.start, cc.start) && near(pc.end, cc.end)
    );
    remaining_prev = matchPass(
      remaining_prev,
      remaining_curr,
      changes,
      (pc, cc) => near(pc.end, cc.end) && near(pc.outPoint, cc.outPoint)
    );
    remaining_prev = matchPass(
      remaining_prev,
      remaining_curr,
      changes,
      (pc, cc) => near(pc.start, cc.start) && near(pc.inPoint, cc.inPoint)
    );
    for (const clip of remaining_prev) {
      changes.push(makeChange("delete", clip.start, clip, clip, null));
    }
    for (const clip of remaining_curr) {
      changes.push(makeChange("add", clip.start, clip, null, clip));
    }
  }
  const hasDelete = changes.some((c) => c.editType === "delete");
  const filtered = hasDelete ? changes.filter((c) => c.editType !== "move") : changes;
  const moves = filtered.filter((c) => c.editType === "move");
  if (moves.length >= 3) {
    return filtered.filter((c) => c.editType !== "move");
  }
  return deduplicateLinked(filtered);
}
function matchPass(remaining_prev, remaining_curr, changes, predicate) {
  const still_unmatched = [];
  for (const pc of remaining_prev) {
    const idx = remaining_curr.findIndex((cc) => predicate(pc, cc));
    if (idx >= 0) {
      const cc = remaining_curr[idx];
      remaining_curr.splice(idx, 1);
      classifyChange(pc, cc, changes);
    } else {
      still_unmatched.push(pc);
    }
  }
  return still_unmatched;
}
function classifyChange(p, c, changes) {
  const startDiff = Math.abs(p.start - c.start);
  const endDiff = Math.abs(p.end - c.end);
  const inDiff = Math.abs(p.inPoint - c.inPoint);
  const outDiff = Math.abs(p.outPoint - c.outPoint);
  if (startDiff < TOL && endDiff < TOL) return;
  if (startDiff > TOL && endDiff < TOL && inDiff > TOL) {
    changes.push(makeChange("trim-head", c.start, c, p, c));
  } else if (startDiff < TOL && endDiff > TOL && outDiff > TOL) {
    changes.push(makeChange("trim-tail", c.end, c, p, c));
  } else if (startDiff > TOL && endDiff > TOL && inDiff < TOL && outDiff < TOL) {
    changes.push(makeChange("move", c.start, c, p, c));
  } else if (startDiff > TOL || endDiff > TOL) {
    const type = startDiff > endDiff ? "trim-head" : "trim-tail";
    changes.push(makeChange(type, startDiff > endDiff ? c.start : c.end, c, p, c));
  }
}
function makeChange(editType, editPointTime, clip, beforeState, afterState) {
  return {
    editType,
    editPointTime,
    clipName: clip.name,
    mediaPath: clip.mediaPath,
    trackIndex: clip.trackIndex,
    trackType: clip.trackType,
    beforeState,
    afterState,
    isUndo: false
  };
}
function deduplicateLinked(changes) {
  const seen = /* @__PURE__ */ new Map();
  const result = [];
  const sorted = [...changes].sort((a, b) => {
    if (a.trackType === "video" && b.trackType !== "video") return -1;
    if (a.trackType !== "video" && b.trackType === "video") return 1;
    return 0;
  });
  for (const c of sorted) {
    const timeKey = (Math.round(c.editPointTime * 10) / 10).toFixed(1);
    const dedupeKey = `${c.editType}|${timeKey}`;
    if (!seen.has(dedupeKey)) {
      seen.set(dedupeKey, c);
      result.push(c);
    }
  }
  return result;
}
function checkForUndo(curr, history) {
  if (history.length < 2) return false;
  for (let i = history.length - 2; i >= 0; i--) {
    if (history[i].hash === curr.hash) return true;
  }
  return false;
}
function groupByKey(clips) {
  const map = /* @__PURE__ */ new Map();
  for (const clip of clips) {
    if (!map.has(clip.key)) map.set(clip.key, []);
    map.get(clip.key).push(clip);
  }
  return map;
}

// ../../plugins/cutting-board/src/db.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
var CuttingBoardDB = class {
  db;
  constructor(dataDir) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "cutting-board.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL,
        sequence_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        total_edits INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS cut_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        edit_type TEXT NOT NULL,
        edit_point_time REAL NOT NULL,
        clip_name TEXT NOT NULL,
        media_path TEXT NOT NULL,
        track_index INTEGER NOT NULL,
        track_type TEXT NOT NULL,
        before_state TEXT,
        after_state TEXT,
        audio_category TEXT,
        rating INTEGER,
        voice_transcript TEXT,
        notes TEXT,
        is_undo INTEGER NOT NULL DEFAULT 0,
        detected_at INTEGER NOT NULL,
        feedback_at INTEGER,
        boosted INTEGER NOT NULL DEFAULT 0
      );
    `);
    const cols = this.db.prepare("PRAGMA table_info(cut_records)").all();
    if (!cols.some((c) => c.name === "boosted")) {
      this.db.exec(`
        ALTER TABLE cut_records ADD COLUMN boosted INTEGER NOT NULL DEFAULT 0;
        UPDATE cut_records SET rating = 0 WHERE rating IS NOT NULL AND rating <= 2;
        UPDATE cut_records SET rating = 1 WHERE rating IS NOT NULL AND rating >= 3;
      `);
    }
  }
  createSession(sequenceId, sequenceName) {
    const stmt = this.db.prepare(
      "INSERT INTO sessions (sequence_id, sequence_name, started_at) VALUES (?, ?, ?)"
    );
    const result = stmt.run(sequenceId, sequenceName, Date.now());
    return result.lastInsertRowid;
  }
  endSession(sessionId, totalEdits) {
    this.db.prepare(
      "UPDATE sessions SET ended_at = ?, total_edits = ? WHERE id = ?"
    ).run(Date.now(), totalEdits, sessionId);
  }
  insertRecord(record) {
    const stmt = this.db.prepare(`
      INSERT INTO cut_records (
        session_id, edit_type, edit_point_time, clip_name, media_path,
        track_index, track_type, before_state, after_state,
        audio_category, rating, voice_transcript, notes,
        is_undo, detected_at, feedback_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      record.sessionId,
      record.editType,
      record.editPointTime,
      record.clipName,
      record.mediaPath,
      record.trackIndex,
      record.trackType,
      record.beforeState,
      record.afterState,
      record.audioCategory,
      record.rating,
      record.voiceTranscript,
      record.notes,
      record.isUndo ? 1 : 0,
      record.detectedAt,
      record.feedbackAt
    );
    return result.lastInsertRowid;
  }
  updateRating(recordId, rating, notes) {
    this.db.prepare(
      "UPDATE cut_records SET rating = ?, notes = ?, feedback_at = ? WHERE id = ?"
    ).run(rating, notes || null, Date.now(), recordId);
  }
  boostRecord(recordId) {
    this.db.prepare(
      "UPDATE cut_records SET boosted = 1 WHERE id = ?"
    ).run(recordId);
  }
  markPreviousEditAsDown(sessionId, currentRecordId) {
    this.db.prepare(
      "UPDATE cut_records SET rating = 0 WHERE session_id = ? AND id < ? AND is_undo = 0 ORDER BY id DESC LIMIT 1"
    ).run(sessionId, currentRecordId);
  }
  getSessionStats(sessionId) {
    const total = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE session_id = ?"
    ).get(sessionId);
    const byType = this.db.prepare(
      "SELECT edit_type, COUNT(*) as count FROM cut_records WHERE session_id = ? GROUP BY edit_type"
    ).all(sessionId);
    const thumbsUp = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND rating = 1"
    ).get(sessionId).count;
    const thumbsDown = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND rating = 0"
    ).get(sessionId).count;
    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;
    const boostedCount = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND boosted = 1"
    ).get(sessionId).count;
    const undos = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE session_id = ? AND is_undo = 1"
    ).get(sessionId);
    const editsByType = {};
    for (const row of byType) {
      editsByType[row.edit_type] = row.count;
    }
    return {
      totalEdits: total.count,
      editsByType,
      approvalRate,
      thumbsUp,
      thumbsDown,
      boostedCount,
      undoCount: undos.count
    };
  }
  getAggregateStats() {
    const totalEdits = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records"
    ).get().count;
    const totalSessions = this.db.prepare(
      "SELECT COUNT(*) as count FROM sessions"
    ).get().count;
    const thumbsUp = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE rating = 1"
    ).get().count;
    const thumbsDown = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE rating = 0"
    ).get().count;
    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;
    const boostedCount = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE boosted = 1"
    ).get().count;
    const undoCount = this.db.prepare(
      "SELECT COUNT(*) as count FROM cut_records WHERE is_undo = 1"
    ).get().count;
    const undoRate = totalEdits > 0 ? undoCount / totalEdits : 0;
    const byType = this.db.prepare(
      "SELECT edit_type, COUNT(*) as count FROM cut_records GROUP BY edit_type"
    ).all();
    const editsByType = {};
    for (const row of byType) {
      editsByType[row.edit_type] = row.count;
    }
    const recentSessions = this.db.prepare(`
      SELECT s.id, s.sequence_name, s.started_at, s.total_edits,
        (SELECT CASE WHEN COUNT(r.rating) > 0 THEN
          CAST(SUM(CASE WHEN r.rating = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(r.rating)
        ELSE NULL END FROM cut_records r WHERE r.session_id = s.id AND r.rating IS NOT NULL) as approval_rate
      FROM sessions s
      ORDER BY s.started_at DESC
      LIMIT 5
    `).all();
    return {
      totalEdits,
      totalSessions,
      approvalRate,
      thumbsUp,
      thumbsDown,
      boostedCount,
      undoRate,
      editsByType,
      recentSessions: recentSessions.map((s) => ({
        id: s.id,
        sequenceName: s.sequence_name,
        startedAt: s.started_at,
        totalEdits: s.total_edits,
        approvalRate: s.approval_rate
      }))
    };
  }
  getRecentRecords(limit = 20) {
    return this.db.prepare(`
      SELECT cr.*, s.sequence_name
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      ORDER BY cr.detected_at DESC
      LIMIT ?
    `).all(limit);
  }
  exportAllRecords() {
    const sessions = this.db.prepare("SELECT * FROM sessions").all();
    const records = this.db.prepare("SELECT * FROM cut_records").all();
    return { sessions, records };
  }
  getAllForTraining() {
    return this.db.prepare(`
      SELECT cr.*, s.sequence_name
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      WHERE cr.is_undo = 0
      ORDER BY cr.detected_at ASC
    `).all();
  }
  getQualityRecords() {
    const records = this.db.prepare(`
      SELECT cr.*, s.sequence_name
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      WHERE cr.is_undo = 0
      ORDER BY cr.detected_at ASC
    `).all();
    return records.map((r) => {
      let quality;
      let weight;
      if (r.boosted === 1) {
        quality = "boosted";
        weight = 3;
      } else if (r.rating === 1) {
        quality = "good";
        weight = 1;
      } else if (r.rating === 0) {
        quality = "bad";
        weight = 0;
      } else {
        quality = "good";
        weight = 0.5;
      }
      return { ...r, quality, weight };
    });
  }
  close() {
    this.db.close();
  }
};

// ../../plugins/cutting-board/src/pipeline.ts
function extractFeatures(record) {
  const before = safeParseState(record.beforeState);
  const after = safeParseState(record.afterState);
  const beforeDuration = before ? before.end - before.start : null;
  const afterDuration = after ? after.end - after.start : null;
  const context = {
    clipName: record.clipName,
    mediaPath: record.mediaPath,
    trackIndex: record.trackIndex,
    trackType: record.trackType,
    editPointTime: record.editPointTime,
    beforeDuration,
    afterDuration,
    neighborBefore: null,
    neighborAfter: null
  };
  const deltaDuration = beforeDuration != null && afterDuration != null ? afterDuration - beforeDuration : null;
  const deltaStart = before && after ? after.start - before.start : null;
  const deltaEnd = before && after ? after.end - before.end : null;
  let splitRatio = null;
  if (record.editType === "cut" && before && beforeDuration && beforeDuration > 0) {
    splitRatio = (record.editPointTime - before.start) / beforeDuration;
  }
  const action = {
    editType: record.editType,
    deltaDuration,
    deltaStart,
    deltaEnd,
    splitRatio
  };
  return {
    id: record.id,
    editType: record.editType,
    quality: record.quality,
    weight: record.weight,
    context,
    action,
    timestamp: record.detectedAt
  };
}
function toJSONL(examples) {
  return examples.map((ex) => JSON.stringify(ex)).join("\n");
}
function formatForPrompt(examples, limit = 10) {
  const selected = examples.sort((a, b) => b.weight - a.weight).slice(0, limit);
  if (selected.length === 0) return "";
  const lines = selected.map((ex) => {
    const qualityTag = ex.quality === "boosted" ? "[EXCELLENT]" : ex.quality === "good" ? "[GOOD]" : "[AVOID]";
    return `${qualityTag} ${ex.editType} on "${ex.context.clipName}" at ${ex.context.editPointTime.toFixed(2)}s` + (ex.action.deltaDuration != null ? ` | delta=${ex.action.deltaDuration.toFixed(2)}s` : "") + (ex.action.splitRatio != null ? ` | splitRatio=${ex.action.splitRatio.toFixed(2)}` : "");
  });
  return `Editor's historical edit patterns:
${lines.join("\n")}`;
}
function safeParseState(stateJson) {
  if (!stateJson) return null;
  try {
    const parsed = JSON.parse(stateJson);
    const clip = Array.isArray(parsed) ? parsed[0] : parsed;
    if (clip && typeof clip.start === "number") return clip;
    return null;
  } catch {
    return null;
  }
}

// ../../plugins/cutting-board/src/example-bank.ts
var ExampleBank = class {
  examples = [];
  load(records) {
    this.examples = records.map((r) => extractFeatures(r));
  }
  get size() {
    return this.examples.length;
  }
  getSimilar(query, limit = 5) {
    if (this.examples.length === 0) return [];
    const scored = this.examples.map((ex) => ({
      example: ex,
      score: this.similarityScore(query, ex) * ex.weight
    }));
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).filter((s) => s.score > 0).map((s) => s.example);
  }
  getBestExamples(limit = 10) {
    if (this.examples.length === 0) return [];
    const byType = /* @__PURE__ */ new Map();
    for (const ex of this.examples) {
      if (!byType.has(ex.editType)) byType.set(ex.editType, []);
      byType.get(ex.editType).push(ex);
    }
    for (const [, exs] of byType) {
      exs.sort((a, b) => b.weight - a.weight);
    }
    const result = [];
    const types = [...byType.keys()];
    let round = 0;
    while (result.length < limit) {
      let added = false;
      for (const type of types) {
        const exs = byType.get(type);
        if (round < exs.length) {
          result.push(exs[round]);
          added = true;
          if (result.length >= limit) break;
        }
      }
      if (!added) break;
      round++;
    }
    return result;
  }
  getDistribution() {
    const dist = {};
    for (const ex of this.examples) {
      if (!dist[ex.editType]) {
        dist[ex.editType] = { total: 0, boosted: 0, good: 0, bad: 0 };
      }
      dist[ex.editType].total++;
      if (ex.quality === "boosted") dist[ex.editType].boosted++;
      else if (ex.quality === "good") dist[ex.editType].good++;
      else dist[ex.editType].bad++;
    }
    return dist;
  }
  similarityScore(query, example) {
    let score = 0;
    if (query.trackType === example.context.trackType) score += 1;
    if (query.trackIndex === example.context.trackIndex) score += 0.5;
    const timeDiff = Math.abs(query.editPointTime - example.context.editPointTime);
    if (timeDiff < 30) score += 1 - timeDiff / 30;
    if (query.mediaPath && query.mediaPath === example.context.mediaPath) score += 2;
    if (query.beforeDuration != null && example.context.beforeDuration != null) {
      const durDiff = Math.abs(query.beforeDuration - example.context.beforeDuration);
      if (durDiff < 5) score += 1 - durDiff / 5;
    }
    return score;
  }
};

// ../../plugins/cutting-board/src/index.ts
var POLL_INTERVAL = 500;
var SNAPSHOT_RING_SIZE = 20;
var db = null;
var pollTimer = null;
var currentSessionId = null;
var previousSnapshot = null;
var snapshotHistory = [];
var editCount = 0;
var eventSubs = [];
var recentEdits = /* @__PURE__ */ new Map();
var DEDUPE_WINDOW = 2e3;
function isDuplicate(change) {
  const timeKey = (Math.round(change.editPointTime * 10) / 10).toFixed(1);
  const key = `${change.editType}|${timeKey}`;
  const now = Date.now();
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
var pollCount = 0;
async function pollTimeline(ctx) {
  try {
    const seq = await ctx.services.timeline.getActiveSequence();
    if (!seq) {
      ctx.log.warn("Poll: no active sequence");
      return;
    }
    const totalClips = seq.videoTracks.reduce((n, t) => n + t.clips.length, 0) + seq.audioTracks.reduce((n, t) => n + t.clips.length, 0);
    const snapshot = createSnapshot(seq);
    if (!previousSnapshot) {
      ctx.log.info(`Poll: first snapshot, ${totalClips} clips, hash=${snapshot.hash.slice(0, 8)}`);
      previousSnapshot = snapshot;
      snapshotHistory.push(snapshot);
      return;
    }
    pollCount++;
    if (pollCount % 20 === 0) {
      ctx.log.debug(`Poll #${pollCount}: ${totalClips} clips, hash=${snapshot.hash.slice(0, 8)} (prev=${previousSnapshot.hash.slice(0, 8)})`);
    }
    if (snapshot.hash === previousSnapshot.hash) return;
    ctx.log.info(`Poll: hash changed! ${previousSnapshot.hash.slice(0, 8)} -> ${snapshot.hash.slice(0, 8)}, ${totalClips} clips`);
    const isUndo = checkForUndo(snapshot, snapshotHistory);
    const changes = diffSnapshots(previousSnapshot, snapshot);
    if (changes.length === 0) {
      const prevByKey = /* @__PURE__ */ new Map();
      const currByKey = /* @__PURE__ */ new Map();
      for (const c of previousSnapshot.clips) prevByKey.set(c.key, (prevByKey.get(c.key) || 0) + 1);
      for (const c of snapshot.clips) currByKey.set(c.key, (currByKey.get(c.key) || 0) + 1);
      const diffs = [];
      const allKeys = /* @__PURE__ */ new Set([...prevByKey.keys(), ...currByKey.keys()]);
      for (const k of allKeys) {
        const p = prevByKey.get(k) || 0;
        const c = currByKey.get(k) || 0;
        if (p !== c) diffs.push(`"${k.split("|")[0].slice(0, 30)}": ${p}->${c}`);
      }
      ctx.log.warn(`Diff returned 0 changes despite hash change. Group diffs: ${diffs.join(", ") || "none"}`);
    }
    if (changes.length > 0 && currentSessionId != null && db) {
      for (const change of changes) {
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
          feedbackAt: now
        });
        if (isUndo) {
          db.markPreviousEditAsDown(currentSessionId, recordId);
        }
        editCount++;
        ctx.log.info(`Edit detected: ${change.editType} on "${change.clipName}" at ${change.editPointTime.toFixed(2)}s${isUndo ? " (undo)" : ""}`);
        ctx.ui.pushToPanel("feedback-request", {
          recordId,
          editType: change.editType,
          clipName: change.clipName,
          editPointTime: change.editPointTime,
          trackType: change.trackType,
          isUndo: change.isUndo
        });
      }
    }
    snapshotHistory.push(snapshot);
    if (snapshotHistory.length > SNAPSHOT_RING_SIZE) {
      snapshotHistory.shift();
    }
    previousSnapshot = snapshot;
  } catch (err) {
    ctx.log.error("Poll error:", err);
  }
}
var src_default = definePlugin({
  async activate(ctx) {
    db = new CuttingBoardDB(ctx.dataDir);
    eventSubs.push(ctx.onEvent("plugin:cutting-board:boost", (data) => {
      const { recordId } = data;
      if (db) {
        db.boostRecord(recordId);
        ctx.log.info(`Boosted record ${recordId}`);
      }
    }));
    ctx.log.info("Cutting Board activated");
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
    ctx.log.info("Cutting Board deactivated");
  },
  commands: {
    "start-capture": async (ctx) => {
      if (pollTimer) {
        ctx.ui.showToast("Already capturing", "warning");
        return { capturing: true };
      }
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast("No active sequence \u2014 open a sequence first", "warning");
        return null;
      }
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      currentSessionId = db.createSession(seq.sequenceId, seq.name);
      editCount = 0;
      previousSnapshot = null;
      snapshotHistory = [];
      pollTimer = setInterval(() => pollTimeline(ctx), POLL_INTERVAL);
      ctx.log.info(`Capturing edits on "${seq.name}" (session ${currentSessionId})`);
      ctx.ui.showToast(`Capturing edits on "${seq.name}"`, "success");
      return { sessionId: currentSessionId, sequence: seq.name };
    },
    "stop-capture": async (ctx) => {
      if (!pollTimer || currentSessionId == null) {
        ctx.ui.showToast("Not currently capturing", "warning");
        return null;
      }
      clearInterval(pollTimer);
      pollTimer = null;
      if (db) {
        db.endSession(currentSessionId, editCount);
        const stats = db.getSessionStats(currentSessionId);
        const typeSummary = Object.entries(stats.editsByType).map(([type, count]) => `${count} ${type}`).join(", ");
        const msg = `Session ended: ${stats.totalEdits} edits (${typeSummary})${stats.approvalRate != null ? `, ${(stats.approvalRate * 100).toFixed(0)}% approval` : ""}`;
        ctx.log.info(msg);
        ctx.ui.showToast(msg, "info");
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
        ctx.ui.showToast("No active session", "warning");
        return null;
      }
      const stats = db.getSessionStats(currentSessionId);
      const msg = `Edits: ${stats.totalEdits} | \u{1F44D} ${stats.thumbsUp} | \u{1F44E} ${stats.thumbsDown} | Undos: ${stats.undoCount}${stats.approvalRate != null ? ` | ${(stats.approvalRate * 100).toFixed(0)}%` : ""}`;
      ctx.ui.showToast(msg, "info");
      return stats;
    },
    "training-stats": async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      return db.getAggregateStats();
    },
    "export-training": async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      const records = db.getQualityRecords();
      if (records.length === 0) {
        ctx.ui.showToast("No training data available", "warning");
        return null;
      }
      const examples = records.map((r) => extractFeatures(r));
      const jsonl = toJSONL(examples);
      const exportPath = (await import("path")).join(ctx.dataDir, `training-${Date.now()}.jsonl`);
      (await import("fs")).writeFileSync(exportPath, jsonl);
      const bank = new ExampleBank();
      bank.load(records);
      const dist = bank.getDistribution();
      ctx.ui.showToast(`Exported ${examples.length} training examples`, "success");
      ctx.log.info(`Training data exported to ${exportPath}`);
      return {
        path: exportPath,
        count: examples.length,
        distribution: dist,
        promptPreview: formatForPrompt(examples, 5)
      };
    },
    "export-data": async (ctx) => {
      if (!db) {
        ctx.ui.showToast("No data available", "warning");
        return null;
      }
      const data = db.exportAllRecords();
      const exportPath = (await import("path")).join(ctx.dataDir, `export-${Date.now()}.json`);
      (await import("fs")).writeFileSync(exportPath, JSON.stringify(data, null, 2));
      ctx.ui.showToast(`Exported ${data.records.length} records to ${exportPath}`, "success");
      ctx.log.info(`Exported data to ${exportPath}`);
      return { path: exportPath, sessions: data.sessions.length, records: data.records.length };
    }
  }
});
export {
  src_default as default
};
