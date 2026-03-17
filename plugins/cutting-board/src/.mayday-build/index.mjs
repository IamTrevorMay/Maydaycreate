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

      CREATE TABLE IF NOT EXISTS model_training_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trained_at INTEGER NOT NULL,
        training_size INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        version INTEGER NOT NULL
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
    if (!cols.some((c) => c.name === "synced_at")) {
      this.db.exec(`ALTER TABLE cut_records ADD COLUMN synced_at INTEGER;`);
    }
    const sessionCols = this.db.prepare("PRAGMA table_info(sessions)").all();
    if (!sessionCols.some((c) => c.name === "synced_at")) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN synced_at INTEGER;`);
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
      SELECT
        cr.id, cr.session_id AS sessionId, cr.edit_type AS editType,
        cr.edit_point_time AS editPointTime, cr.clip_name AS clipName,
        cr.media_path AS mediaPath, cr.track_index AS trackIndex,
        cr.track_type AS trackType, cr.before_state AS beforeState,
        cr.after_state AS afterState, cr.audio_category AS audioCategory,
        cr.rating, cr.voice_transcript AS voiceTranscript, cr.notes,
        cr.is_undo AS isUndo, cr.detected_at AS detectedAt,
        cr.feedback_at AS feedbackAt, cr.boosted,
        s.sequence_name AS sequenceName
      FROM cut_records cr
      JOIN sessions s ON cr.session_id = s.id
      WHERE cr.is_undo = 0
      ORDER BY cr.detected_at ASC
    `).all();
  }
  getQualityRecords() {
    const records = this.db.prepare(`
      SELECT
        cr.id, cr.session_id AS sessionId, cr.edit_type AS editType,
        cr.edit_point_time AS editPointTime, cr.clip_name AS clipName,
        cr.media_path AS mediaPath, cr.track_index AS trackIndex,
        cr.track_type AS trackType, cr.before_state AS beforeState,
        cr.after_state AS afterState, cr.audio_category AS audioCategory,
        cr.rating, cr.voice_transcript AS voiceTranscript, cr.notes,
        cr.is_undo AS isUndo, cr.detected_at AS detectedAt,
        cr.feedback_at AS feedbackAt, cr.boosted,
        s.sequence_name AS sequenceName
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
  getUnsyncedSessions() {
    return this.db.prepare(
      "SELECT * FROM sessions WHERE synced_at IS NULL"
    ).all();
  }
  getUnsyncedRecords(limit = 500) {
    return this.db.prepare(
      "SELECT cr.*, s.sequence_id, s.sequence_name FROM cut_records cr JOIN sessions s ON cr.session_id = s.id WHERE cr.synced_at IS NULL LIMIT ?"
    ).all(limit);
  }
  markSynced(table, ids) {
    if (ids.length === 0) return;
    const now = Date.now();
    const placeholders = ids.map(() => "?").join(",");
    this.db.prepare(
      `UPDATE ${table} SET synced_at = ? WHERE id IN (${placeholders})`
    ).run(now, ...ids);
  }
  recordTrainingRun(trainingSize, accuracy, version) {
    const stmt = this.db.prepare(
      "INSERT INTO model_training_runs (trained_at, training_size, accuracy, version) VALUES (?, ?, ?, ?)"
    );
    const result = stmt.run(Date.now(), trainingSize, accuracy, version);
    return result.lastInsertRowid;
  }
  getLatestTrainingRun() {
    return this.db.prepare(
      "SELECT id, trained_at as trainedAt, training_size as trainingSize, accuracy, version FROM model_training_runs ORDER BY trained_at DESC LIMIT 1"
    ).get() ?? null;
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

// ../../plugins/cutting-board/src/model.ts
import brain from "brain.js";

// ../../plugins/cutting-board/src/autocut-types.ts
var EDIT_TYPES = ["cut", "trim-head", "trim-tail", "delete", "move", "add"];

// ../../plugins/cutting-board/src/model.ts
import fs2 from "fs";
import path2 from "path";
var MAX_DURATION = 60;
var MAX_GAP = 10;
var MAX_TRACK_INDEX = 10;
var MAX_TIME_SINCE_EDIT = 6e4;
function featureToVector(example, recentEdits2) {
  const ctx = example.context;
  const trackType = ctx.trackType === "audio" ? 1 : 0;
  const trackIndex = Math.min(ctx.trackIndex / MAX_TRACK_INDEX, 1);
  const clipDuration = ctx.beforeDuration != null ? Math.min(ctx.beforeDuration / MAX_DURATION, 1) : 0.5;
  const clipPosition = Math.min(ctx.editPointTime / 600, 1);
  const playheadInClip = example.action.splitRatio ?? 0.5;
  const timeSinceLastEdit = recentEdits2.length > 0 ? Math.min((example.timestamp - recentEdits2[recentEdits2.length - 1].timestamp) / MAX_TIME_SINCE_EDIT, 1) : 1;
  const hasNeighborBefore = ctx.neighborBefore ? 1 : 0;
  const hasNeighborAfter = ctx.neighborAfter ? 1 : 0;
  const gapBefore = ctx.neighborBefore ? Math.min(Math.max(0, ctx.editPointTime - ctx.neighborBefore.end) / MAX_GAP, 1) : 0;
  const gapAfter = ctx.neighborAfter ? Math.min(Math.max(0, ctx.neighborAfter.start - ctx.editPointTime) / MAX_GAP, 1) : 0;
  const last10 = recentEdits2.slice(-10);
  const total = Math.max(last10.length, 1);
  const recentCutFrac = last10.filter((e) => e.editType === "cut").length / total;
  const recentTrimHeadFrac = last10.filter((e) => e.editType === "trim-head").length / total;
  const recentTrimTailFrac = last10.filter((e) => e.editType === "trim-tail").length / total;
  const recentDeleteFrac = last10.filter((e) => e.editType === "delete").length / total;
  const ratedEdits = last10.filter((e) => e.quality !== "bad");
  const recentApprovalRate = last10.length > 0 ? ratedEdits.length / last10.length : 0.5;
  return [
    trackType,
    trackIndex,
    clipDuration,
    clipPosition,
    playheadInClip,
    timeSinceLastEdit,
    hasNeighborBefore,
    hasNeighborAfter,
    gapBefore,
    gapAfter,
    recentCutFrac,
    recentTrimHeadFrac,
    recentTrimTailFrac,
    recentDeleteFrac,
    recentApprovalRate
  ];
}
function editTypeToOutput(editType) {
  const output = {};
  for (const t of EDIT_TYPES) {
    output[t] = t === editType ? 1 : 0;
  }
  return output;
}
function trainClassifier(examples) {
  const trainingData = [];
  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    if (ex.quality === "bad") continue;
    const recentEdits2 = examples.slice(0, i);
    const input = featureToVector(ex, recentEdits2);
    const output = editTypeToOutput(ex.editType);
    const copies = ex.quality === "boosted" ? 3 : 1;
    for (let c = 0; c < copies; c++) {
      trainingData.push({ input, output });
    }
  }
  console.log(`[Model] Training on ${trainingData.length} samples`);
  const net = new brain.NeuralNetwork({
    hiddenLayers: [32, 16],
    activation: "sigmoid"
  });
  const result = net.train(trainingData, {
    iterations: 2e4,
    errorThresh: 5e-3,
    log: false,
    logPeriod: 1e3
  });
  console.log(`[Model] Training complete: ${result.iterations} iterations, error: ${result.error.toFixed(6)}`);
  let correct = 0;
  for (const item of trainingData) {
    const prediction = net.run(item.input);
    const predicted = Object.entries(prediction).sort((a, b) => b[1] - a[1])[0][0];
    const actual = Object.entries(item.output).find(([, v]) => v === 1)?.[0] ?? "unknown";
    if (predicted === actual) correct++;
  }
  const accuracy = trainingData.length > 0 ? correct / trainingData.length : 0;
  console.log(`[Model] Accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${trainingData.length})`);
  return { model: net.toJSON(), accuracy };
}
function trainRegressor(editType, examples) {
  const filtered = examples.filter((e) => e.editType === editType && e.quality !== "bad");
  if (filtered.length < 5) return null;
  const net = new brain.NeuralNetwork({
    hiddenLayers: [16, 8],
    activation: "sigmoid"
  });
  const trainingData = [];
  for (const ex of filtered) {
    const idx = examples.indexOf(ex);
    const recentEdits2 = examples.slice(0, idx);
    const input = featureToVector(ex, recentEdits2);
    const output = getParameterOutput(ex);
    if (!output) continue;
    const copies = ex.quality === "boosted" ? 3 : 1;
    for (let c = 0; c < copies; c++) {
      trainingData.push({ input, output });
    }
  }
  if (trainingData.length < 3) return null;
  net.train(trainingData, {
    iterations: 1e3,
    errorThresh: 0.02,
    log: false
  });
  return net.toJSON();
}
function getParameterOutput(example) {
  switch (example.editType) {
    case "cut":
      return [example.action.splitRatio ?? 0.5];
    case "trim-head":
    case "trim-tail": {
      const amount = Math.abs(example.action.deltaDuration ?? 0);
      return [Math.min(amount / MAX_DURATION, 1)];
    }
    case "delete":
      return [1];
    case "move": {
      const offset = Math.abs(example.action.deltaStart ?? 0);
      return [Math.min(offset / MAX_DURATION, 1)];
    }
    case "add":
      return [0.5];
    default:
      return null;
  }
}
function instantiateNet(json) {
  const net = new brain.NeuralNetwork();
  net.fromJSON(json);
  return net;
}
function saveModel(model, dataDir) {
  const filePath = path2.join(dataDir, "autocut-model.json");
  fs2.writeFileSync(filePath, JSON.stringify(model));
}
function loadModel(dataDir) {
  const filePath = path2.join(dataDir, "autocut-model.json");
  if (!fs2.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs2.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ../../plugins/cutting-board/src/inference.ts
var MAX_DURATION2 = 60;
var MAX_GAP2 = 10;
var MAX_TRACK_INDEX2 = 10;
function findTargetClip(sequence, playheadPosition) {
  for (const trackType of ["video", "audio"]) {
    const tracks = trackType === "video" ? sequence.videoTracks : sequence.audioTracks;
    for (const track of tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i];
        if (playheadPosition >= clip.start && playheadPosition <= clip.end) {
          return {
            clip,
            trackIndex: track.index,
            trackType,
            clipIndex: i,
            neighborBefore: i > 0 ? track.clips[i - 1] : null,
            neighborAfter: i < track.clips.length - 1 ? track.clips[i + 1] : null
          };
        }
      }
    }
  }
  let nearest = null;
  for (const trackType of ["video", "audio"]) {
    const tracks = trackType === "video" ? sequence.videoTracks : sequence.audioTracks;
    for (const track of tracks) {
      for (let i = 0; i < track.clips.length; i++) {
        const clip = track.clips[i];
        const dist = Math.min(
          Math.abs(clip.start - playheadPosition),
          Math.abs(clip.end - playheadPosition)
        );
        if (!nearest || dist < nearest.dist) {
          nearest = {
            clip,
            dist,
            trackIndex: track.index,
            trackType,
            clipIndex: i,
            neighborBefore: i > 0 ? track.clips[i - 1] : null,
            neighborAfter: i < track.clips.length - 1 ? track.clips[i + 1] : null
          };
        }
      }
    }
  }
  if (nearest && nearest.dist < 5) {
    const { dist, ...result } = nearest;
    return result;
  }
  return null;
}
function buildInferenceInput(clip, playheadPosition, recentEdits2, neighborBefore, neighborAfter) {
  const trackType = clip.trackType === "audio" ? 1 : 0;
  const trackIndex = Math.min(clip.trackIndex / MAX_TRACK_INDEX2, 1);
  const clipDuration = Math.min(clip.duration / MAX_DURATION2, 1);
  const clipPosition = Math.min(clip.start / 600, 1);
  const playheadInClip = clip.duration > 0 ? Math.max(0, Math.min(1, (playheadPosition - clip.start) / clip.duration)) : 0.5;
  const now = Date.now();
  const lastEditTime = recentEdits2.length > 0 ? recentEdits2[recentEdits2.length - 1].timestamp : 0;
  const timeSinceLastEdit = lastEditTime > 0 ? Math.min((now - lastEditTime) / 6e4, 1) : 1;
  const hasNeighborBefore = neighborBefore ? 1 : 0;
  const hasNeighborAfter = neighborAfter ? 1 : 0;
  const gapBefore = neighborBefore ? Math.min(Math.max(0, clip.start - neighborBefore.end) / MAX_GAP2, 1) : 0;
  const gapAfter = neighborAfter ? Math.min(Math.max(0, neighborAfter.start - clip.end) / MAX_GAP2, 1) : 0;
  const last10 = recentEdits2.slice(-10);
  const total = Math.max(last10.length, 1);
  const recentCutFrac = last10.filter((e) => e.editType === "cut").length / total;
  const recentTrimHeadFrac = last10.filter((e) => e.editType === "trim-head").length / total;
  const recentTrimTailFrac = last10.filter((e) => e.editType === "trim-tail").length / total;
  const recentDeleteFrac = last10.filter((e) => e.editType === "delete").length / total;
  const approved = last10.filter((e) => e.quality !== "bad").length;
  const recentApprovalRate = last10.length > 0 ? approved / last10.length : 0.5;
  return [
    trackType,
    trackIndex,
    clipDuration,
    clipPosition,
    playheadInClip,
    timeSinceLastEdit,
    hasNeighborBefore,
    hasNeighborAfter,
    gapBefore,
    gapAfter,
    recentCutFrac,
    recentTrimHeadFrac,
    recentTrimTailFrac,
    recentDeleteFrac,
    recentApprovalRate
  ];
}
function runInference(input, classifier, regressors, clip, threshold) {
  const classifierOutput = classifier.run(input);
  const sorted = Object.entries(classifierOutput).sort((a, b) => b[1] - a[1]);
  const [bestType, bestConfidence] = sorted[0];
  if (bestConfidence < threshold) return null;
  let parameters = {};
  const regressor = regressors.get(bestType);
  if (regressor) {
    const paramOutput = regressor.run(input);
    parameters = decodeParameters(bestType, Array.from(paramOutput), clip.duration);
  } else {
    parameters = defaultParameters(bestType, clip.duration);
  }
  return {
    editType: bestType,
    confidence: bestConfidence,
    parameters,
    targetClip: {
      trackIndex: clip.trackIndex,
      trackType: clip.trackType,
      clipIndex: clip.clipIndex,
      clipName: clip.name,
      start: clip.start,
      end: clip.end
    },
    createdAt: Date.now()
  };
}
function decodeParameters(editType, output, clipDuration) {
  const val = output[0] ?? 0.5;
  switch (editType) {
    case "cut":
      return { splitRatio: Math.max(0.05, Math.min(0.95, val)) };
    case "trim-head":
    case "trim-tail":
      return { trimAmount: val * Math.min(clipDuration, MAX_DURATION2) };
    case "delete":
      return { ripple: val > 0.5 };
    default:
      return {};
  }
}
function defaultParameters(editType, clipDuration) {
  switch (editType) {
    case "cut":
      return { splitRatio: 0.5 };
    case "trim-head":
    case "trim-tail":
      return { trimAmount: clipDuration * 0.1 };
    case "delete":
      return { ripple: true };
    default:
      return {};
  }
}

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
var autocutEnabled = false;
var autocutClassifier = null;
var autocutRegressors = /* @__PURE__ */ new Map();
var autocutThreshold = 0.6;
var lastSuggestionTime = 0;
var currentSuggestion = null;
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
  autocutEnabled = false;
  autocutClassifier = null;
  autocutRegressors = /* @__PURE__ */ new Map();
  currentSuggestion = null;
}
async function runAutocutSuggestion(ctx) {
  try {
    const seq = await ctx.services.timeline.getActiveSequence();
    if (!seq) return;
    const playhead = await ctx.services.timeline.getPlayheadPosition();
    const target = findTargetClip(seq, playhead);
    if (!target) return;
    const recentRecords = db ? db.getRecentRecords(10) : [];
    const recentEditHistory = recentRecords.map((r) => ({
      editType: r.edit_type,
      timestamp: r.detected_at,
      quality: r.rating === 1 ? "good" : r.rating === 0 ? "bad" : "good"
    }));
    const input = buildInferenceInput(
      target.clip,
      playhead,
      recentEditHistory,
      target.neighborBefore,
      target.neighborAfter
    );
    const suggestion = runInference(input, autocutClassifier, autocutRegressors, {
      trackIndex: target.trackIndex,
      trackType: target.trackType,
      clipIndex: target.clipIndex,
      name: target.clip.name,
      start: target.clip.start,
      end: target.clip.end,
      duration: target.clip.duration
    }, autocutThreshold);
    if (suggestion) {
      currentSuggestion = suggestion;
      lastSuggestionTime = Date.now();
      ctx.ui.pushToPanel("autocut-suggestion", suggestion);
      ctx.log.debug(`Autocut suggestion: ${suggestion.editType} (${(suggestion.confidence * 100).toFixed(0)}%) on "${suggestion.targetClip.clipName}"`);
    }
  } catch (err) {
    ctx.log.error("Autocut inference error:", err);
  }
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
    if (snapshot.hash === previousSnapshot.hash) {
      if (autocutEnabled && autocutClassifier && Date.now() - lastSuggestionTime > 3e3) {
        await runAutocutSuggestion(ctx);
      }
      return;
    }
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
    const tryAutoStart = async () => {
      if (pollTimer) return;
      try {
        const seq = await ctx.services.timeline.getActiveSequence();
        if (seq && db) {
          currentSessionId = db.createSession(seq.sequenceId, seq.name);
          editCount = 0;
          previousSnapshot = null;
          snapshotHistory = [];
          pollTimer = setInterval(() => pollTimeline(ctx), POLL_INTERVAL);
          ctx.log.info(`Auto-started capture on "${seq.name}" (session ${currentSessionId})`);
        }
      } catch {
      }
    };
    await tryAutoStart();
    if (!pollTimer) {
      const retryTimer = setInterval(async () => {
        await tryAutoStart();
        if (pollTimer) clearInterval(retryTimer);
      }, 5e3);
      eventSubs.push({ unsubscribe: () => clearInterval(retryTimer) });
    }
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
    },
    "sync-data": async (ctx) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      const sessions = db.getUnsyncedSessions();
      const records = db.getUnsyncedRecords(500);
      return { sessions, records };
    },
    "mark-synced": async (ctx, args) => {
      if (!db) {
        db = new CuttingBoardDB(ctx.dataDir);
      }
      const { table, ids } = args;
      db.markSynced(table, ids);
      return { marked: ids.length };
    },
    "train-model": async (ctx) => {
      if (!db) db = new CuttingBoardDB(ctx.dataDir);
      const records = db.getQualityRecords();
      if (records.length < 30) {
        ctx.ui.showToast(`Need at least 30 edits for training (have ${records.length})`, "warning");
        return null;
      }
      const examples = records.map((r) => extractFeatures(r));
      ctx.log.info(`Training classifier on ${examples.length} examples...`);
      const { model: classifierJson, accuracy } = trainClassifier(examples);
      const regressorJsons = {};
      for (const editType of ["cut", "trim-head", "trim-tail", "delete", "move", "add"]) {
        const regressorJson = trainRegressor(editType, examples);
        if (regressorJson) {
          regressorJsons[editType] = regressorJson;
          ctx.log.info(`Trained ${editType} regressor`);
        }
      }
      const latestRun = db.getLatestTrainingRun();
      const version = (latestRun?.version ?? 0) + 1;
      const serialized = {
        version,
        trainedAt: Date.now(),
        trainingSize: examples.length,
        accuracy,
        classifier: classifierJson,
        regressors: regressorJsons
      };
      saveModel(serialized, ctx.dataDir);
      db.recordTrainingRun(examples.length, accuracy, version);
      const msg = `Model v${version} trained: ${(accuracy * 100).toFixed(1)}% accuracy on ${examples.length} examples`;
      ctx.log.info(msg);
      ctx.ui.showToast(msg, "success");
      return { version, accuracy, trainingSize: examples.length, regressors: Object.keys(regressorJsons) };
    },
    "start-autocut": async (ctx) => {
      if (autocutEnabled) {
        ctx.ui.showToast("Autocut already running", "warning");
        return { enabled: true };
      }
      const serialized = loadModel(ctx.dataDir);
      if (!serialized) {
        ctx.ui.showToast("No trained model found \u2014 run train-model first", "warning");
        return null;
      }
      autocutClassifier = instantiateNet(serialized.classifier);
      autocutRegressors = /* @__PURE__ */ new Map();
      for (const [editType, json] of Object.entries(serialized.regressors)) {
        autocutRegressors.set(editType, instantiateNet(json));
      }
      autocutEnabled = true;
      lastSuggestionTime = 0;
      currentSuggestion = null;
      ctx.log.info(`Autocut started (model v${serialized.version}, ${(serialized.accuracy * 100).toFixed(1)}% accuracy)`);
      ctx.ui.showToast("Autocut enabled", "success");
      return { version: serialized.version, accuracy: serialized.accuracy };
    },
    "stop-autocut": async (ctx) => {
      autocutEnabled = false;
      autocutClassifier = null;
      autocutRegressors = /* @__PURE__ */ new Map();
      currentSuggestion = null;
      ctx.ui.showToast("Autocut disabled", "info");
      return { enabled: false };
    },
    "autocut-status": async (ctx) => {
      if (!db) db = new CuttingBoardDB(ctx.dataDir);
      const serialized = loadModel(ctx.dataDir);
      const status = {
        enabled: autocutEnabled,
        model: serialized ? {
          version: serialized.version,
          trainedAt: serialized.trainedAt,
          trainingSize: serialized.trainingSize,
          accuracy: serialized.accuracy,
          regressors: Object.keys(serialized.regressors),
          staleness: Math.round((Date.now() - serialized.trainedAt) / 1e3 / 60)
        } : null,
        threshold: autocutThreshold,
        currentSuggestion: currentSuggestion ? {
          editType: currentSuggestion.editType,
          confidence: currentSuggestion.confidence,
          clipName: currentSuggestion.targetClip.clipName
        } : null
      };
      if (serialized) {
        ctx.ui.showToast(
          `Autocut ${autocutEnabled ? "ON" : "OFF"} | Model v${serialized.version}: ${(serialized.accuracy * 100).toFixed(0)}% accuracy, ${serialized.trainingSize} examples, ${status.model.staleness}m old`,
          "info"
        );
      } else {
        ctx.ui.showToast("No model trained yet", "info");
      }
      return status;
    },
    "accept-suggestion": async (ctx) => {
      if (!currentSuggestion) {
        ctx.ui.showToast("No current suggestion", "warning");
        return null;
      }
      const suggestion = currentSuggestion;
      const { timeline } = ctx.services;
      const seq = await timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast("No active sequence", "warning");
        return null;
      }
      const tracks = suggestion.targetClip.trackType === "video" ? seq.videoTracks : seq.audioTracks;
      const track = tracks.find((t) => t.index === suggestion.targetClip.trackIndex);
      if (!track || suggestion.targetClip.clipIndex >= track.clips.length) {
        ctx.ui.showToast("Target clip no longer exists", "warning");
        currentSuggestion = null;
        return null;
      }
      const clip = track.clips[suggestion.targetClip.clipIndex];
      let success = false;
      try {
        switch (suggestion.editType) {
          case "cut": {
            const splitTime = clip.start + (suggestion.parameters.splitRatio ?? 0.5) * clip.duration;
            success = await timeline.splitClip(
              suggestion.targetClip.trackIndex,
              suggestion.targetClip.clipIndex,
              suggestion.targetClip.trackType,
              splitTime
            );
            break;
          }
          case "trim-head": {
            const trimAmount = suggestion.parameters.trimAmount ?? clip.duration * 0.1;
            success = await timeline.setClipInOutPoints(
              suggestion.targetClip.trackIndex,
              suggestion.targetClip.clipIndex,
              clip.inPoint + trimAmount,
              clip.outPoint
            );
            break;
          }
          case "trim-tail": {
            const trimAmount = suggestion.parameters.trimAmount ?? clip.duration * 0.1;
            success = await timeline.setClipInOutPoints(
              suggestion.targetClip.trackIndex,
              suggestion.targetClip.clipIndex,
              clip.inPoint,
              clip.outPoint - trimAmount
            );
            break;
          }
          case "delete": {
            if (suggestion.parameters.ripple) {
              success = await timeline.rippleDelete(
                suggestion.targetClip.trackIndex,
                suggestion.targetClip.clipIndex,
                suggestion.targetClip.trackType
              );
            } else {
              success = await timeline.liftClip(
                suggestion.targetClip.trackIndex,
                suggestion.targetClip.clipIndex,
                suggestion.targetClip.trackType
              );
            }
            break;
          }
          default:
            ctx.ui.showToast(`Unsupported edit type: ${suggestion.editType}`, "warning");
            return null;
        }
      } catch (err) {
        ctx.log.error("Failed to execute suggestion:", err);
        ctx.ui.showToast("Failed to execute suggestion", "error");
        return null;
      }
      if (success) {
        ctx.ui.showToast(`Applied ${suggestion.editType} edit`, "success");
        currentSuggestion = null;
      } else {
        ctx.ui.showToast("Edit execution failed", "error");
      }
      return { success, editType: suggestion.editType };
    }
  }
});
export {
  src_default as default
};
