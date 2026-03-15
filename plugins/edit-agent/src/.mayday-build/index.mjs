// ../../plugins/edit-agent/src/index.ts
import path3 from "path";

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

// ../../plugins/edit-agent/src/db.ts
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
var AgentDB = class {
  db;
  constructor(dataDir) {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path.join(dataDir, "edit-agent.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }
  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sequence_id TEXT NOT NULL,
        sequence_name TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        cycle_count INTEGER DEFAULT 0,
        proposals_generated INTEGER DEFAULT 0,
        proposals_accepted INTEGER DEFAULT 0,
        proposals_rejected INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES agent_sessions(id),
        edit_type TEXT NOT NULL,
        description TEXT NOT NULL,
        confidence REAL NOT NULL,
        reasoning TEXT NOT NULL,
        action_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        executed_at INTEGER
      );
    `);
  }
  createSession(sequenceId, sequenceName) {
    const result = this.db.prepare(
      "INSERT INTO agent_sessions (sequence_id, sequence_name, started_at) VALUES (?, ?, ?)"
    ).run(sequenceId, sequenceName, Date.now());
    return result.lastInsertRowid;
  }
  endSession(sessionId, stats) {
    this.db.prepare(
      "UPDATE agent_sessions SET ended_at = ?, cycle_count = ?, proposals_generated = ?, proposals_accepted = ?, proposals_rejected = ? WHERE id = ?"
    ).run(Date.now(), stats.cycleCount, stats.generated, stats.accepted, stats.rejected, sessionId);
  }
  insertProposal(sessionId, proposal) {
    const result = this.db.prepare(`
      INSERT INTO proposals (session_id, edit_type, description, confidence, reasoning, action_json, status, created_at, executed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      proposal.editType,
      proposal.description,
      proposal.confidence,
      proposal.reasoning,
      JSON.stringify(proposal.action),
      proposal.status,
      proposal.createdAt,
      proposal.executedAt
    );
    return result.lastInsertRowid;
  }
  updateProposalStatus(proposalId, status) {
    const executedAt = status === "executed" || status === "failed" ? Date.now() : null;
    this.db.prepare(
      "UPDATE proposals SET status = ?, executed_at = COALESCE(?, executed_at) WHERE id = ?"
    ).run(status, executedAt, proposalId);
  }
  getPendingProposals(sessionId) {
    const rows = this.db.prepare(
      "SELECT * FROM proposals WHERE session_id = ? AND status = ? ORDER BY confidence DESC"
    ).all(sessionId, "pending");
    return rows.map((r) => this.rowToProposal(r));
  }
  getProposalById(proposalId) {
    const row = this.db.prepare("SELECT * FROM proposals WHERE id = ?").get(proposalId);
    return row ? this.rowToProposal(row) : null;
  }
  getProposalStats(sessionId) {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const params = sessionId ? [sessionId] : [];
    const total = this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where}`).get(...params).c;
    const accepted = this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + " AND" : "WHERE"} status = 'accepted'`).get(...params).c;
    const rejected = this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + " AND" : "WHERE"} status = 'rejected'`).get(...params).c;
    const executed = this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + " AND" : "WHERE"} status = 'executed'`).get(...params).c;
    const failed = this.db.prepare(`SELECT COUNT(*) as c FROM proposals ${where ? where + " AND" : "WHERE"} status = 'failed'`).get(...params).c;
    const avgAccepted = this.db.prepare(
      `SELECT AVG(confidence) as avg FROM proposals ${where ? where + " AND" : "WHERE"} status IN ('accepted', 'executed')`
    ).get(...params)?.avg || 0;
    const avgRejected = this.db.prepare(
      `SELECT AVG(confidence) as avg FROM proposals ${where ? where + " AND" : "WHERE"} status = 'rejected'`
    ).get(...params)?.avg || 0;
    return { total, accepted: accepted + executed, rejected, executed, failed, avgConfidenceAccepted: avgAccepted, avgConfidenceRejected: avgRejected };
  }
  rowToProposal(row) {
    return {
      id: row.id,
      editType: row.edit_type,
      description: row.description,
      confidence: row.confidence,
      reasoning: row.reasoning,
      action: JSON.parse(row.action_json),
      status: row.status,
      createdAt: row.created_at,
      executedAt: row.executed_at,
      sessionId: row.session_id
    };
  }
  close() {
    this.db.close();
  }
};

// ../../plugins/edit-agent/src/prompt-builder.ts
var SYSTEM_PROMPT = `You are an expert video editor AI assistant. You analyze timeline state and suggest precise edit operations.

RULES:
- Only suggest edits you are confident about
- Never suggest edits on locked or muted tracks
- Prefer conservative edits (trims) over destructive ones (deletes)
- Each suggestion must include exact parameters for execution
- Respond ONLY with a JSON array, no other text

RESPONSE FORMAT:
[
  {
    "editType": "trim-head" | "trim-tail" | "split" | "delete" | "insert" | "move" | "enable" | "disable",
    "description": "Human-readable description of the edit",
    "confidence": 0.0-1.0,
    "reasoning": "Why this edit improves the timeline",
    "trackIndex": number,
    "trackType": "video" | "audio",
    "clipIndex": number,
    "params": {
      "splitTime": number (seconds, for split),
      "newInPoint": number (seconds, for trim-head),
      "newOutPoint": number (seconds, for trim-tail),
      "ripple": boolean (for delete),
      "insertTime": number (seconds, for insert/move),
      "projectItemPath": string (media path, for insert),
      "moveToTime": number (seconds, for move),
      "enabled": boolean (for enable/disable)
    }
  }
]`;
function buildAnalysisPrompt(sequence, examples, userInstruction, proposalStats) {
  const parts = [];
  parts.push("## Current Timeline State");
  parts.push(`Sequence: "${sequence.name}" | Duration: ${sequence.duration.toFixed(2)}s | Frame Rate: ${sequence.frameRate}`);
  parts.push("");
  for (const track of sequence.videoTracks) {
    if (track.clips.length === 0) continue;
    parts.push(formatTrack(track));
  }
  for (const track of sequence.audioTracks) {
    if (track.clips.length === 0) continue;
    parts.push(formatTrack(track));
  }
  parts.push("");
  if (examples.length > 0) {
    parts.push("## Editor's Historical Patterns");
    parts.push("These are edits the editor has made before, rated by quality:");
    for (const ex of examples) {
      const qualityTag = ex.quality === "boosted" ? "[EXCELLENT]" : ex.quality === "good" ? "[GOOD]" : "[AVOID]";
      const details = [];
      if (ex.action.deltaDuration != null) details.push(`delta=${ex.action.deltaDuration.toFixed(2)}s`);
      if (ex.action.splitRatio != null) details.push(`splitRatio=${ex.action.splitRatio.toFixed(2)}`);
      parts.push(`  ${qualityTag} ${ex.editType} on "${ex.context.clipName}" at ${ex.context.editPointTime.toFixed(2)}s${details.length ? " | " + details.join(", ") : ""}`);
    }
    parts.push("");
  }
  if (proposalStats && proposalStats.total > 10) {
    const acceptRate = (proposalStats.accepted / proposalStats.total * 100).toFixed(0);
    parts.push("## Your Past Accuracy");
    parts.push(`Of your ${proposalStats.total} previous suggestions, ${acceptRate}% were accepted. Average confidence of accepted edits: ${(proposalStats.avgConfidenceAccepted * 100).toFixed(0)}%. Calibrate accordingly.`);
    parts.push("");
  }
  if (userInstruction) {
    parts.push("## User Instruction");
    parts.push(userInstruction);
    parts.push("");
  }
  parts.push("Analyze the timeline and suggest edits. Return a JSON array of proposals.");
  return parts.join("\n");
}
function getSystemPrompt() {
  return SYSTEM_PROMPT;
}
function formatTrack(track) {
  const lockTag = track.locked ? " [LOCKED]" : "";
  const muteTag = track.muted ? " [MUTED]" : "";
  const lines = [`### ${track.type.toUpperCase()} Track ${track.index}: "${track.name}"${lockTag}${muteTag}`];
  for (let i = 0; i < track.clips.length; i++) {
    const clip = track.clips[i];
    const gap = i > 0 ? clip.start - track.clips[i - 1].end : 0;
    if (gap > 0.1) {
      lines.push(`  [GAP ${gap.toFixed(2)}s]`);
    }
    lines.push(formatClip(clip, i));
  }
  return lines.join("\n");
}
function formatClip(clip, index) {
  const enabled = clip.enabled ? "" : " [DISABLED]";
  return `  [${index}] "${clip.name}" ${clip.start.toFixed(2)}s-${clip.end.toFixed(2)}s (dur=${clip.duration.toFixed(2)}s, in=${clip.inPoint.toFixed(2)}, out=${clip.outPoint.toFixed(2)}, speed=${clip.speed})${enabled}`;
}

// ../../plugins/edit-agent/src/response-parser.ts
var VALID_EDIT_TYPES = ["split", "trim-head", "trim-tail", "delete", "insert", "move", "enable", "disable"];
function parseResponse(responseText, sessionId) {
  const jsonStr = extractJSON(responseText);
  if (!jsonStr) return [];
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const proposals = [];
  const now = Date.now();
  for (const item of parsed) {
    const proposal = validateProposal(item, sessionId, now);
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}
function extractJSON(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) return trimmed;
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return null;
}
function validateProposal(item, sessionId, timestamp) {
  if (!item || typeof item !== "object") return null;
  const editType = item.editType;
  if (!VALID_EDIT_TYPES.includes(editType)) return null;
  const confidence = typeof item.confidence === "number" ? Math.max(0, Math.min(1, item.confidence)) : 0.5;
  const description = typeof item.description === "string" ? item.description : `${editType} edit`;
  const reasoning = typeof item.reasoning === "string" ? item.reasoning : "";
  const trackIndex = typeof item.trackIndex === "number" ? item.trackIndex : 0;
  const trackType = item.trackType === "audio" ? "audio" : "video";
  const clipIndex = typeof item.clipIndex === "number" ? item.clipIndex : 0;
  const params = item.params && typeof item.params === "object" ? item.params : {};
  const action = {
    type: editType,
    trackIndex,
    trackType,
    clipIndex,
    params: {
      splitTime: typeof params.splitTime === "number" ? params.splitTime : void 0,
      newInPoint: typeof params.newInPoint === "number" ? params.newInPoint : void 0,
      newOutPoint: typeof params.newOutPoint === "number" ? params.newOutPoint : void 0,
      ripple: typeof params.ripple === "boolean" ? params.ripple : void 0,
      insertTime: typeof params.insertTime === "number" ? params.insertTime : void 0,
      projectItemPath: typeof params.projectItemPath === "string" ? params.projectItemPath : void 0,
      moveToTime: typeof params.moveToTime === "number" ? params.moveToTime : void 0,
      enabled: typeof params.enabled === "boolean" ? params.enabled : void 0
    }
  };
  return {
    id: 0,
    // assigned by DB
    editType,
    description,
    confidence,
    reasoning,
    action,
    status: "pending",
    createdAt: timestamp,
    executedAt: null,
    sessionId
  };
}

// ../../plugins/edit-agent/src/action-executor.ts
async function executeProposal(ctx, proposal, sequence) {
  const { action } = proposal;
  const { timeline } = ctx.services;
  const tracks = action.trackType === "audio" ? sequence.audioTracks : sequence.videoTracks;
  if (action.trackIndex >= tracks.length) {
    ctx.log.error(`Track ${action.trackType} ${action.trackIndex} does not exist`);
    return false;
  }
  const track = tracks[action.trackIndex];
  if (track.locked) {
    ctx.log.error(`Track ${action.trackType} ${action.trackIndex} is locked`);
    return false;
  }
  if (["split", "trim-head", "trim-tail", "delete", "move", "enable", "disable"].includes(action.type)) {
    if (action.clipIndex >= track.clips.length) {
      ctx.log.error(`Clip ${action.clipIndex} does not exist on track ${action.trackType} ${action.trackIndex}`);
      return false;
    }
  }
  try {
    switch (action.type) {
      case "split": {
        if (action.params.splitTime == null) return false;
        return await timeline.splitClip(action.trackIndex, action.clipIndex, action.trackType, action.params.splitTime);
      }
      case "trim-head": {
        if (action.params.newInPoint == null) return false;
        const clip = track.clips[action.clipIndex];
        return await timeline.setClipInOutPoints(
          action.trackIndex,
          action.clipIndex,
          action.params.newInPoint,
          clip.outPoint
        );
      }
      case "trim-tail": {
        if (action.params.newOutPoint == null) return false;
        const clip = track.clips[action.clipIndex];
        return await timeline.setClipInOutPoints(
          action.trackIndex,
          action.clipIndex,
          clip.inPoint,
          action.params.newOutPoint
        );
      }
      case "delete": {
        if (action.params.ripple) {
          return await timeline.rippleDelete(action.trackIndex, action.clipIndex, action.trackType);
        } else {
          return await timeline.liftClip(action.trackIndex, action.clipIndex, action.trackType);
        }
      }
      case "insert": {
        if (action.params.insertTime == null || action.params.projectItemPath == null) return false;
        return await timeline.insertClip(action.trackIndex, action.trackType, action.params.projectItemPath, action.params.insertTime);
      }
      case "move": {
        if (action.params.moveToTime == null) return false;
        const clip = track.clips[action.clipIndex];
        const liftOk = await timeline.liftClip(action.trackIndex, action.clipIndex, action.trackType);
        if (!liftOk) return false;
        const insertOk = await timeline.insertClip(action.trackIndex, action.trackType, clip.mediaPath, action.params.moveToTime);
        if (!insertOk) return false;
        return true;
      }
      case "enable": {
        return await timeline.setClipEnabled(action.trackIndex, action.clipIndex, action.trackType, true);
      }
      case "disable": {
        return await timeline.setClipEnabled(action.trackIndex, action.clipIndex, action.trackType, false);
      }
      default:
        ctx.log.error(`Unknown action type: ${action.type}`);
        return false;
    }
  } catch (err) {
    ctx.log.error(`Failed to execute ${action.type}:`, err);
    return false;
  }
}

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

// ../../plugins/cutting-board/src/db.ts
import Database2 from "better-sqlite3";
import path2 from "path";
import fs2 from "fs";
var CuttingBoardDB = class {
  db;
  constructor(dataDir) {
    if (!fs2.existsSync(dataDir)) {
      fs2.mkdirSync(dataDir, { recursive: true });
    }
    const dbPath = path2.join(dataDir, "cutting-board.db");
    this.db = new Database2(dbPath);
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

// ../../plugins/edit-agent/src/learning.ts
var BUCKET_RANGES = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1]
];
function computeCalibration(db2) {
  const stats = db2.getProposalStats();
  if (stats.total < 5) {
    return {
      buckets: BUCKET_RANGES.map((range) => ({ range, total: 0, accepted: 0, acceptanceRate: 0 })),
      recommendedThreshold: 0.7,
      calibrationScore: 0
    };
  }
  const buckets = BUCKET_RANGES.map((range) => ({
    range,
    total: 0,
    accepted: 0,
    acceptanceRate: 0
  }));
  const overallAcceptanceRate = stats.total > 0 ? stats.accepted / stats.total : 0;
  for (const bucket of buckets) {
    const midpoint = (bucket.range[0] + bucket.range[1]) / 2;
    const expectedRate = Math.min(1, overallAcceptanceRate * (midpoint / 0.5));
    bucket.acceptanceRate = expectedRate;
    bucket.total = Math.round(stats.total / BUCKET_RANGES.length);
    bucket.accepted = Math.round(bucket.total * expectedRate);
  }
  let recommendedThreshold = 0.7;
  for (const bucket of buckets) {
    if (bucket.acceptanceRate >= 0.8 && bucket.total >= 2) {
      recommendedThreshold = bucket.range[0];
      break;
    }
  }
  const midpoints = buckets.map((b) => (b.range[0] + b.range[1]) / 2);
  const rates = buckets.map((b) => b.acceptanceRate);
  const calibrationScore = correlation(midpoints, rates);
  return {
    buckets,
    recommendedThreshold: Math.max(0.3, Math.min(0.9, recommendedThreshold)),
    calibrationScore: Math.max(0, calibrationScore)
  };
}
function correlation(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

// ../../plugins/edit-agent/src/index.ts
var LOOP_INTERVAL = 1e4;
var db = null;
var agentState = {
  mode: "suggest",
  running: false,
  cycleCount: 0,
  lastAnalysisTime: null,
  lastTimelineHash: null,
  proposals: [],
  sessionId: null,
  exampleCount: 0
};
var loopTimer = null;
var exampleBank = null;
var eventSubs = [];
function computeTimelineHash(seq) {
  const parts = [];
  for (const track of [...seq.videoTracks, ...seq.audioTracks]) {
    for (const clip of track.clips) {
      parts.push(`${clip.trackIndex}:${clip.start.toFixed(3)}:${clip.end.toFixed(3)}`);
    }
  }
  let hash = 0;
  const str = parts.join("|");
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
  }
  return hash.toString(36);
}
function loadExampleBank(cuttingBoardDataDir) {
  if (!exampleBank) {
    exampleBank = new ExampleBank();
  }
  try {
    const cbDb = new CuttingBoardDB(cuttingBoardDataDir);
    const records = cbDb.getQualityRecords();
    exampleBank.load(records);
    cbDb.close();
  } catch {
  }
  return exampleBank;
}
function getCuttingBoardDataDir(agentDataDir) {
  return path3.resolve(agentDataDir, "..", "..", "cutting-board", "data");
}
async function runAnalysis(ctx, userInstruction) {
  const seq = await ctx.services.timeline.getActiveSequence();
  if (!seq) {
    ctx.log.warn("No active sequence");
    return [];
  }
  const bank = loadExampleBank(getCuttingBoardDataDir(ctx.dataDir));
  agentState.exampleCount = bank.size;
  const bestExamples = bank.getBestExamples(10);
  let proposalStats;
  if (db && agentState.sessionId) {
    const stats = db.getProposalStats();
    if (stats.total > 10) {
      proposalStats = { total: stats.total, accepted: stats.accepted, avgConfidenceAccepted: stats.avgConfidenceAccepted };
    }
  }
  const prompt = buildAnalysisPrompt(seq, bestExamples, userInstruction, proposalStats);
  const maxProposals = ctx.config["max-proposals"] || 10;
  ctx.log.info(`Analyzing timeline (${bank.size} examples, ${seq.videoTracks.reduce((n, t) => n + t.clips.length, 0)} video clips)`);
  const response = await ctx.services.ai.complete(prompt, {
    system: getSystemPrompt(),
    maxTokens: 4096,
    temperature: 0.3
  });
  const sessionId = agentState.sessionId || 0;
  let proposals = parseResponse(response, sessionId);
  proposals = proposals.slice(0, maxProposals);
  if (db && agentState.sessionId) {
    for (const p of proposals) {
      p.id = db.insertProposal(agentState.sessionId, p);
      p.sessionId = agentState.sessionId;
    }
  }
  agentState.proposals = proposals;
  agentState.lastAnalysisTime = Date.now();
  agentState.lastTimelineHash = computeTimelineHash(seq);
  return proposals;
}
async function agentLoop(ctx) {
  try {
    const seq = await ctx.services.timeline.getActiveSequence();
    if (!seq) return;
    const hash = computeTimelineHash(seq);
    if (hash === agentState.lastTimelineHash) return;
    agentState.cycleCount++;
    ctx.log.info(`Agent cycle #${agentState.cycleCount}: timeline changed`);
    const proposals = await runAnalysis(ctx);
    if (proposals.length === 0) {
      ctx.log.info("No proposals generated");
      return;
    }
    const mode = agentState.mode;
    ctx.ui.pushToPanel("proposals", proposals.map((p) => ({
      id: p.id,
      editType: p.editType,
      description: p.description,
      confidence: p.confidence,
      reasoning: p.reasoning,
      status: p.status
    })));
    if (mode === "preview") {
      for (const p of proposals) {
        const time = p.action.params.splitTime || p.action.params.insertTime || p.action.params.moveToTime || 0;
        if (time > 0) {
          await ctx.services.timeline.addMarker(
            time,
            `Agent: ${p.editType}`,
            p.confidence >= 0.7 ? "green" : "yellow",
            p.description
          );
        }
      }
    }
    if (mode === "auto") {
      const threshold = ctx.config.threshold || 0.7;
      for (const p of proposals) {
        if (p.confidence >= threshold) {
          ctx.log.info(`Auto-executing: ${p.description} (confidence=${p.confidence.toFixed(2)})`);
          const freshSeq = await ctx.services.timeline.getActiveSequence();
          if (!freshSeq) break;
          const ok = await executeProposal(ctx, p, freshSeq);
          const newStatus = ok ? "executed" : "failed";
          p.status = newStatus;
          if (db) db.updateProposalStatus(p.id, newStatus);
          ctx.ui.pushToPanel("proposal-update", {
            id: p.id,
            status: newStatus
          });
        }
      }
    }
  } catch (err) {
    ctx.log.error("Agent loop error:", err);
  }
}
var src_default = definePlugin({
  async activate(ctx) {
    db = new AgentDB(ctx.dataDir);
    agentState.mode = ctx.config.mode || "suggest";
    eventSubs.push(ctx.onEvent("plugin:edit-agent:accept", async (data) => {
      const { proposalId } = data;
      if (!db) return;
      const proposal = db.getProposalById(proposalId);
      if (!proposal || proposal.status !== "pending") return;
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) return;
      const ok = await executeProposal(ctx, proposal, seq);
      const newStatus = ok ? "executed" : "failed";
      db.updateProposalStatus(proposalId, newStatus);
      const p = agentState.proposals.find((p2) => p2.id === proposalId);
      if (p) p.status = newStatus;
      ctx.ui.pushToPanel("proposal-update", { id: proposalId, status: newStatus });
      ctx.log.info(`Proposal ${proposalId} ${newStatus}: ${proposal.description}`);
    }));
    eventSubs.push(ctx.onEvent("plugin:edit-agent:reject", (data) => {
      const { proposalId } = data;
      if (!db) return;
      db.updateProposalStatus(proposalId, "rejected");
      const p = agentState.proposals.find((p2) => p2.id === proposalId);
      if (p) p.status = "rejected";
      ctx.ui.pushToPanel("proposal-update", { id: proposalId, status: "rejected" });
      ctx.log.info(`Proposal ${proposalId} rejected`);
    }));
    ctx.log.info("Edit Agent activated");
  },
  async deactivate(ctx) {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    if (db && agentState.sessionId) {
      const pending = agentState.proposals.filter((p) => p.status === "pending").length;
      const accepted = agentState.proposals.filter((p) => p.status === "executed" || p.status === "accepted").length;
      const rejected = agentState.proposals.filter((p) => p.status === "rejected").length;
      db.endSession(agentState.sessionId, {
        cycleCount: agentState.cycleCount,
        generated: agentState.proposals.length,
        accepted,
        rejected
      });
    }
    for (const sub of eventSubs) sub.unsubscribe();
    eventSubs = [];
    db?.close();
    db = null;
    agentState = {
      mode: "suggest",
      running: false,
      cycleCount: 0,
      lastAnalysisTime: null,
      lastTimelineHash: null,
      proposals: [],
      sessionId: null,
      exampleCount: 0
    };
    exampleBank = null;
    ctx.log.info("Edit Agent deactivated");
  },
  commands: {
    analyze: async (ctx, args) => {
      const instruction = args?.instruction;
      if (!db) db = new AgentDB(ctx.dataDir);
      if (!agentState.sessionId) {
        const seq = await ctx.services.timeline.getActiveSequence();
        if (!seq) {
          ctx.ui.showToast("No active sequence", "warning");
          return null;
        }
        agentState.sessionId = db.createSession(seq.sequenceId, seq.name);
      }
      ctx.ui.showProgress("Analyzing timeline...", 0.5);
      const proposals = await runAnalysis(ctx, instruction);
      ctx.ui.hideProgress();
      if (proposals.length === 0) {
        ctx.ui.showToast("No edit suggestions", "info");
      } else {
        ctx.ui.showToast(`${proposals.length} edit suggestions`, "success");
      }
      return proposals.map((p) => ({
        id: p.id,
        editType: p.editType,
        description: p.description,
        confidence: p.confidence,
        reasoning: p.reasoning,
        status: p.status
      }));
    },
    "execute-next": async (ctx) => {
      const pending = agentState.proposals.filter((p) => p.status === "pending");
      if (pending.length === 0) {
        ctx.ui.showToast("No pending proposals", "info");
        return null;
      }
      const proposal = pending.sort((a, b) => b.confidence - a.confidence)[0];
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast("No active sequence", "warning");
        return null;
      }
      const ok = await executeProposal(ctx, proposal, seq);
      const newStatus = ok ? "executed" : "failed";
      proposal.status = newStatus;
      if (db) db.updateProposalStatus(proposal.id, newStatus);
      ctx.ui.pushToPanel("proposal-update", { id: proposal.id, status: newStatus });
      ctx.ui.showToast(`${ok ? "Executed" : "Failed"}: ${proposal.description}`, ok ? "success" : "error");
      return { id: proposal.id, status: newStatus, description: proposal.description };
    },
    "accept-all": async (ctx) => {
      const pending = agentState.proposals.filter((p) => p.status === "pending");
      let executed = 0;
      let failed = 0;
      for (const proposal of pending) {
        const seq = await ctx.services.timeline.getActiveSequence();
        if (!seq) break;
        const ok = await executeProposal(ctx, proposal, seq);
        const newStatus = ok ? "executed" : "failed";
        proposal.status = newStatus;
        if (db) db.updateProposalStatus(proposal.id, newStatus);
        ctx.ui.pushToPanel("proposal-update", { id: proposal.id, status: newStatus });
        if (ok) executed++;
        else failed++;
      }
      ctx.ui.showToast(`Executed ${executed}, failed ${failed}`, executed > 0 ? "success" : "warning");
      return { executed, failed };
    },
    "reject-all": async (ctx) => {
      const pending = agentState.proposals.filter((p) => p.status === "pending");
      for (const proposal of pending) {
        proposal.status = "rejected";
        if (db) db.updateProposalStatus(proposal.id, "rejected");
        ctx.ui.pushToPanel("proposal-update", { id: proposal.id, status: "rejected" });
      }
      ctx.ui.showToast(`Rejected ${pending.length} proposals`, "info");
      return { rejected: pending.length };
    },
    "set-mode": async (ctx, args) => {
      const mode = args?.mode;
      if (!["suggest", "preview", "auto"].includes(mode)) {
        ctx.ui.showToast("Invalid mode. Use: suggest, preview, auto", "error");
        return null;
      }
      agentState.mode = mode;
      ctx.ui.showToast(`Agent mode: ${mode}`, "success");
      ctx.ui.pushToPanel("mode-change", { mode });
      return { mode };
    },
    "start-agent": async (ctx) => {
      if (agentState.running) {
        ctx.ui.showToast("Agent already running", "warning");
        return { running: true };
      }
      const seq = await ctx.services.timeline.getActiveSequence();
      if (!seq) {
        ctx.ui.showToast("No active sequence", "warning");
        return null;
      }
      if (!db) db = new AgentDB(ctx.dataDir);
      agentState.sessionId = db.createSession(seq.sequenceId, seq.name);
      agentState.running = true;
      agentState.cycleCount = 0;
      agentState.proposals = [];
      loopTimer = setInterval(() => agentLoop(ctx), LOOP_INTERVAL);
      ctx.log.info(`Agent started on "${seq.name}" in ${agentState.mode} mode`);
      ctx.ui.showToast(`Agent started (${agentState.mode} mode)`, "success");
      return { running: true, mode: agentState.mode, sessionId: agentState.sessionId };
    },
    "stop-agent": async (ctx) => {
      if (!agentState.running) {
        ctx.ui.showToast("Agent not running", "warning");
        return null;
      }
      if (loopTimer) {
        clearInterval(loopTimer);
        loopTimer = null;
      }
      if (db && agentState.sessionId) {
        const accepted = agentState.proposals.filter((p) => p.status === "executed" || p.status === "accepted").length;
        const rejected = agentState.proposals.filter((p) => p.status === "rejected").length;
        db.endSession(agentState.sessionId, {
          cycleCount: agentState.cycleCount,
          generated: agentState.proposals.length,
          accepted,
          rejected
        });
      }
      const stats = {
        cycleCount: agentState.cycleCount,
        totalProposals: agentState.proposals.length,
        executed: agentState.proposals.filter((p) => p.status === "executed").length,
        rejected: agentState.proposals.filter((p) => p.status === "rejected").length
      };
      agentState.running = false;
      agentState.sessionId = null;
      agentState.cycleCount = 0;
      agentState.proposals = [];
      agentState.lastTimelineHash = null;
      ctx.log.info(`Agent stopped. ${stats.cycleCount} cycles, ${stats.totalProposals} proposals`);
      ctx.ui.showToast("Agent stopped", "info");
      return stats;
    },
    "refresh-patterns": async (ctx) => {
      if (!db) db = new AgentDB(ctx.dataDir);
      const bank = loadExampleBank(getCuttingBoardDataDir(ctx.dataDir));
      agentState.exampleCount = bank.size;
      const distribution = bank.getDistribution();
      const calibration = computeCalibration(db);
      const proposalStats = db.getProposalStats();
      if (calibration.calibrationScore > 0.5) {
        ctx.log.info(`Calibration recommends threshold ${calibration.recommendedThreshold.toFixed(2)} (score=${calibration.calibrationScore.toFixed(2)})`);
      }
      ctx.ui.showToast(`${bank.size} examples loaded, calibration=${calibration.calibrationScore.toFixed(2)}`, "success");
      return {
        exampleCount: bank.size,
        distribution,
        calibration,
        proposalStats
      };
    },
    status: async (ctx) => {
      const pending = agentState.proposals.filter((p) => p.status === "pending").length;
      const executed = agentState.proposals.filter((p) => p.status === "executed").length;
      const rejected = agentState.proposals.filter((p) => p.status === "rejected").length;
      return {
        mode: agentState.mode,
        running: agentState.running,
        cycleCount: agentState.cycleCount,
        lastAnalysisTime: agentState.lastAnalysisTime,
        exampleCount: agentState.exampleCount,
        proposals: {
          total: agentState.proposals.length,
          pending,
          executed,
          rejected
        }
      };
    }
  }
});
export {
  src_default as default
};
