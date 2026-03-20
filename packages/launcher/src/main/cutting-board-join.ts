import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config-store.js';

/** Timestamp proximity window in seconds */
const MATCH_WINDOW = 0.5;

interface ModelARecord {
  id: number;
  edit_point_time: number;
  rating: number | null;
  boosted: boolean;
  intent_tags: string[];
}

interface ModelBRecord {
  id: string;
  timestamp: number;
  confidence: string;
  intent_tags: string[];
}

export type ConfidenceTier = 'high' | 'medium' | 'low';

export interface JoinedRecord {
  video_id: string;
  timestamp: number;
  model_a_id: number | null;
  model_b_id: string | null;
  matched: boolean;
  merged_tags: string[];
  model_a_rating: string | null;
  model_b_confidence: string | null;
  confidence_tier: ConfidenceTier;
}

export interface JoinResult {
  videoId: string;
  modelAVideoId: string;
  modelBVideoId: string;
  totalModelA: number;
  totalModelB: number;
  matched: number;
  unmatchedA: number;
  unmatchedB: number;
  written: number;
}

export interface AvailableDatasets {
  modelA: Array<{ videoId: string; count: number }>;
  modelB: Array<{ videoId: string; count: number }>;
}

function deriveRating(record: ModelARecord): string {
  if (record.boosted) return 'boost';
  if (record.rating === 1) return 'good';
  if (record.rating === 0) return 'bad';
  return 'good'; // unrated non-undo defaults to good
}

function mergeTags(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])];
}

function deriveConfidenceTier(matched: boolean, tags: string[]): ConfidenceTier {
  if (matched && tags.length > 0) return 'high';
  if (matched || tags.length > 0) return 'medium';
  return 'low';
}

/**
 * List available video IDs from both models in Supabase.
 */
export async function listAvailableDatasets(): Promise<AvailableDatasets> {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase not configured — set URL and anon key in Settings.');
  }

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const { data: aRows } = await supabase
    .from('cut_records')
    .select('video_id')
    .not('video_id', 'is', null);

  const { data: bRows } = await supabase
    .from('cf_cuts')
    .select('video_id')
    .not('video_id', 'is', null);

  // Count per video_id
  const aCounts: Record<string, number> = {};
  for (const r of aRows ?? []) {
    const vid = r.video_id as string;
    aCounts[vid] = (aCounts[vid] || 0) + 1;
  }

  const bCounts: Record<string, number> = {};
  for (const r of bRows ?? []) {
    const vid = r.video_id as string;
    bCounts[vid] = (bCounts[vid] || 0) + 1;
  }

  return {
    modelA: Object.entries(aCounts).map(([videoId, count]) => ({ videoId, count })).sort((a, b) => b.count - a.count),
    modelB: Object.entries(bCounts).map(([videoId, count]) => ({ videoId, count })).sort((a, b) => b.count - a.count),
  };
}

/**
 * Join Model A (cut-watcher) and Model B (cut-finder) records.
 *
 * Accepts separate video IDs for each model so datasets recorded under
 * different IDs can be paired (e.g. "ep047" from live editing paired
 * with "KWh0HtMCFTQ" from the YouTube upload).
 *
 * Uses a greedy nearest-neighbor match: build candidate pairs within
 * MATCH_WINDOW, sort by proximity, assign closest first.
 */
export async function runCuttingBoardJoin(modelAVideoId: string, modelBVideoId: string): Promise<JoinResult> {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Supabase not configured — set URL and anon key in Settings.');
  }

  // Use the Model B video ID as the canonical video_id in the joined table
  const videoId = modelBVideoId;

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  // ── Fetch Model A records (cut-watcher) ────────────────────────────────
  const { data: rawA, error: errA } = await supabase
    .from('cut_records')
    .select('id, edit_point_time, rating, boosted, intent_tags')
    .eq('video_id', modelAVideoId)
    .order('edit_point_time', { ascending: true });

  if (errA) throw new Error(`Failed to fetch cut_records: ${errA.message}`);

  const modelA: ModelARecord[] = (rawA ?? []).map(r => ({
    id: r.id as number,
    edit_point_time: r.edit_point_time as number,
    rating: r.rating as number | null,
    boosted: r.boosted as boolean,
    intent_tags: Array.isArray(r.intent_tags) ? r.intent_tags as string[] : [],
  }));

  // ── Fetch Model B records (cut-finder) ─────────────────────────────────
  const { data: rawB, error: errB } = await supabase
    .from('cf_cuts')
    .select('id, timestamp, confidence, intent_tags')
    .eq('video_id', modelBVideoId)
    .order('timestamp', { ascending: true });

  if (errB) throw new Error(`Failed to fetch cf_cuts: ${errB.message}`);

  const modelB: ModelBRecord[] = (rawB ?? []).map(r => ({
    id: r.id as string,
    timestamp: r.timestamp as number,
    confidence: r.confidence as string,
    intent_tags: Array.isArray(r.intent_tags) ? r.intent_tags as string[] : [],
  }));

  // ── Match by timestamp proximity ───────────────────────────────────────
  const matchedA = new Set<number>();   // indices into modelA
  const matchedB = new Set<number>();   // indices into modelB
  const pairs: Array<{ aIdx: number; bIdx: number; delta: number }> = [];

  // Build candidate pairs sorted by proximity
  for (let ai = 0; ai < modelA.length; ai++) {
    for (let bi = 0; bi < modelB.length; bi++) {
      const delta = Math.abs(modelA[ai].edit_point_time - modelB[bi].timestamp);
      if (delta <= MATCH_WINDOW) {
        pairs.push({ aIdx: ai, bIdx: bi, delta });
      }
    }
  }

  // Greedy: take closest pairs first, each record matched at most once
  pairs.sort((a, b) => a.delta - b.delta);
  const finalPairs: Array<{ aIdx: number; bIdx: number }> = [];
  for (const p of pairs) {
    if (matchedA.has(p.aIdx) || matchedB.has(p.bIdx)) continue;
    matchedA.add(p.aIdx);
    matchedB.add(p.bIdx);
    finalPairs.push(p);
  }

  // ── Build joined records ───────────────────────────────────────────────
  const joined: JoinedRecord[] = [];

  // Matched pairs
  for (const p of finalPairs) {
    const a = modelA[p.aIdx];
    const b = modelB[p.bIdx];
    const tags = mergeTags(a.intent_tags, b.intent_tags);
    joined.push({
      video_id: videoId,
      timestamp: (a.edit_point_time + b.timestamp) / 2, // average
      model_a_id: a.id,
      model_b_id: b.id,
      matched: true,
      merged_tags: tags,
      model_a_rating: deriveRating(a),
      model_b_confidence: b.confidence,
      confidence_tier: deriveConfidenceTier(true, tags),
    });
  }

  // Unmatched Model A
  for (let i = 0; i < modelA.length; i++) {
    if (matchedA.has(i)) continue;
    const a = modelA[i];
    joined.push({
      video_id: videoId,
      timestamp: a.edit_point_time,
      model_a_id: a.id,
      model_b_id: null,
      matched: false,
      merged_tags: a.intent_tags,
      model_a_rating: deriveRating(a),
      model_b_confidence: null,
      confidence_tier: deriveConfidenceTier(false, a.intent_tags),
    });
  }

  // Unmatched Model B
  for (let i = 0; i < modelB.length; i++) {
    if (matchedB.has(i)) continue;
    const b = modelB[i];
    joined.push({
      video_id: videoId,
      timestamp: b.timestamp,
      model_a_id: null,
      model_b_id: b.id,
      matched: false,
      merged_tags: b.intent_tags,
      model_a_rating: null,
      model_b_confidence: b.confidence,
      confidence_tier: deriveConfidenceTier(false, b.intent_tags),
    });
  }

  // Sort by timestamp
  joined.sort((a, b) => a.timestamp - b.timestamp);

  // ── Write to Supabase ──────────────────────────────────────────────────
  // Delete previous join results for this video (idempotent re-run)
  await supabase
    .from('cutting_board_joined')
    .delete()
    .eq('video_id', videoId);

  let written = 0;
  if (joined.length > 0) {
    // Supabase has a row limit per request; batch in chunks of 500
    const BATCH = 500;
    for (let i = 0; i < joined.length; i += BATCH) {
      const batch = joined.slice(i, i + BATCH);
      const { error } = await supabase
        .from('cutting_board_joined')
        .insert(batch);

      if (error) {
        console.error('[CuttingBoardJoin] Insert error:', error.message);
      } else {
        written += batch.length;
      }
    }
  }

  const result: JoinResult = {
    videoId,
    modelAVideoId,
    modelBVideoId,
    totalModelA: modelA.length,
    totalModelB: modelB.length,
    matched: finalPairs.length,
    unmatchedA: modelA.length - matchedA.size,
    unmatchedB: modelB.length - matchedB.size,
    written,
  };

  console.log(`[CuttingBoardJoin] A:${modelAVideoId} + B:${modelBVideoId} → ${result.matched} matched, ${result.unmatchedA} A-only, ${result.unmatchedB} B-only → ${written} rows written`);
  return result;
}
