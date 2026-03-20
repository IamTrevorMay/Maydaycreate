import { ipcMain, app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import Database from 'better-sqlite3';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config-store.js';
import { runCuttingBoardJoin, listAvailableDatasets } from './cutting-board-join.js';
import { CutFinder } from './cutting-board-finder/cut-finder.js';
import { CutFinderSyncService } from './cutting-board-finder/cut-finder-sync.js';
import type { CuttingBoardAggregateStats, CuttingBoardTrainingRun, CutFinderExportOptions } from '@mayday/types';

let _cutFinder: CutFinder | null = null;
let _cutFinderSync: CutFinderSyncService | null = null;

function getDbPath(): string {
  // In dev mode, userData is "Electron"; in packaged mode it's "@mayday/launcher"
  // Check both locations so dev mode can read data from the packaged app's DB
  const primary = path.join(app.getPath('userData'), 'plugin-data', 'cutting-board', 'cutting-board.db');
  if (fs.existsSync(primary)) return primary;

  const packaged = path.join(app.getPath('home'), 'Library', 'Application Support', '@mayday', 'launcher', 'plugin-data', 'cutting-board', 'cutting-board.db');
  if (fs.existsSync(packaged)) {
    console.log('[CuttingBoard] Using packaged DB path:', packaged);
    return packaged;
  }

  console.log('[CuttingBoard] No DB found. Primary:', primary, 'Packaged:', packaged);
  return primary;
}

function openDb(): Database.Database | null {
  const dbPath = getDbPath();
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

function getAggregateStatsLocal(): CuttingBoardAggregateStats | null {
  const db = openDb();
  if (!db) return null;

  try {
    const totalEdits = (db.prepare('SELECT COUNT(*) as c FROM cut_records').get() as { c: number }).c;
    const totalSessions = (db.prepare('SELECT COUNT(*) as c FROM sessions').get() as { c: number }).c;
    const thumbsUp = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE rating = 1').get() as { c: number }).c;
    const thumbsDown = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE rating = 0').get() as { c: number }).c;
    const boostedCount = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE boosted = 1').get() as { c: number }).c;
    const undoCount = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE is_undo = 1').get() as { c: number }).c;

    const rated = thumbsUp + thumbsDown;
    const approvalRate = rated > 0 ? thumbsUp / rated : null;
    const undoRate = totalEdits > 0 ? undoCount / totalEdits : 0;

    const editTypeRows = db.prepare('SELECT edit_type, COUNT(*) as count FROM cut_records GROUP BY edit_type').all() as { edit_type: string; count: number }[];
    const editsByType: Record<string, number> = {};
    for (const row of editTypeRows) {
      editsByType[row.edit_type] = row.count;
    }

    const sessionRows = db.prepare('SELECT id, sequence_name, started_at, total_edits FROM sessions ORDER BY started_at DESC LIMIT 5').all() as {
      id: string; sequence_name: string; started_at: string; total_edits: number;
    }[];

    const recentSessions: CuttingBoardAggregateStats['recentSessions'] = [];
    for (const s of sessionRows) {
      const sUp = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE session_id = ? AND rating = 1').get(s.id) as { c: number }).c;
      const sDown = (db.prepare('SELECT COUNT(*) as c FROM cut_records WHERE session_id = ? AND rating = 0').get(s.id) as { c: number }).c;
      const sRated = sUp + sDown;
      recentSessions.push({
        id: s.id,
        sequenceName: s.sequence_name,
        startedAt: s.started_at,
        totalEdits: s.total_edits,
        approvalRate: sRated > 0 ? sUp / sRated : null,
      });
    }

    // Aggregate intent tag counts
    const tagRows = db.prepare(
      "SELECT intent_tags FROM cut_records WHERE intent_tags IS NOT NULL AND intent_tags != '[]'"
    ).all() as { intent_tags: string }[];
    const tagCounts: Record<string, number> = {};
    for (const row of tagRows) {
      try {
        const tags: string[] = JSON.parse(row.intent_tags);
        for (const t of tags) {
          tagCounts[t] = (tagCounts[t] || 0) + 1;
        }
      } catch { /* skip malformed */ }
    }

    return {
      totalEdits,
      totalSessions,
      approvalRate,
      thumbsUp,
      thumbsDown,
      boostedCount,
      undoRate,
      editsByType,
      tagCounts,
      recentSessions,
    };
  } catch (err) {
    console.error('[CuttingBoard] Local getAggregateStats error:', err);
    return null;
  } finally {
    db.close();
  }
}

async function getAggregateStatsSupabase(): Promise<CuttingBoardAggregateStats | null> {
  const config = loadConfig();
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null;

  const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

  const { count: totalEdits } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true });

  const { count: totalSessions } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true });

  const { count: thumbsUp } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('rating', 1);

  const { count: thumbsDown } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('rating', 0);

  const { count: boostedCount } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('boosted', true);

  const { count: undoCount } = await supabase
    .from('cut_records')
    .select('*', { count: 'exact', head: true })
    .eq('is_undo', true);

  const { data: editTypes } = await supabase.rpc('get_edit_type_counts');

  const rated = (thumbsUp ?? 0) + (thumbsDown ?? 0);
  const approvalRate = rated > 0 ? (thumbsUp ?? 0) / rated : null;
  const total = totalEdits ?? 0;
  const undoRate = total > 0 ? (undoCount ?? 0) / total : 0;

  const editsByType: Record<string, number> = {};
  if (editTypes) {
    for (const row of editTypes) {
      editsByType[row.edit_type] = Number(row.count);
    }
  }

  const { data: sessionRows } = await supabase
    .from('sessions')
    .select('id, sequence_name, started_at, total_edits')
    .order('started_at', { ascending: false })
    .limit(5);

  const recentSessions: CuttingBoardAggregateStats['recentSessions'] = [];
  if (sessionRows) {
    for (const s of sessionRows) {
      const { count: sessionUp } = await supabase
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', s.id)
        .eq('rating', 1);

      const { count: sessionDown } = await supabase
        .from('cut_records')
        .select('*', { count: 'exact', head: true })
        .eq('session_id', s.id)
        .eq('rating', 0);

      const sessionRated = (sessionUp ?? 0) + (sessionDown ?? 0);
      const sessionApproval = sessionRated > 0 ? (sessionUp ?? 0) / sessionRated : null;

      recentSessions.push({
        id: s.id,
        sequenceName: s.sequence_name,
        startedAt: s.started_at,
        totalEdits: s.total_edits,
        approvalRate: sessionApproval,
      });
    }
  }

  // Fetch tag counts from Supabase
  const tagCounts: Record<string, number> = {};
  const { data: taggedRows } = await supabase
    .from('cut_records')
    .select('intent_tags')
    .not('intent_tags', 'is', null);
  if (taggedRows) {
    for (const row of taggedRows) {
      const tags = Array.isArray(row.intent_tags) ? row.intent_tags : [];
      for (const t of tags) {
        tagCounts[t as string] = (tagCounts[t as string] || 0) + 1;
      }
    }
  }

  return {
    totalEdits: total,
    totalSessions: totalSessions ?? 0,
    approvalRate,
    thumbsUp: thumbsUp ?? 0,
    thumbsDown: thumbsDown ?? 0,
    boostedCount: boostedCount ?? 0,
    undoRate,
    editsByType,
    tagCounts,
    recentSessions,
  };
}

async function getAggregateStats(): Promise<CuttingBoardAggregateStats | null> {
  // Try Supabase first, fall back to local SQLite
  try {
    const result = await getAggregateStatsSupabase();
    if (result) return result;
  } catch (err) {
    console.error('[CuttingBoard] Supabase getAggregateStats error:', err);
  }

  return getAggregateStatsLocal();
}

function getTrainingRuns(): CuttingBoardTrainingRun[] {
  const db = openDb();
  if (!db) return [];

  try {
    const rows = db.prepare('SELECT id, trained_at, training_size, accuracy, version FROM model_training_runs ORDER BY trained_at DESC').all() as {
      id: number; trained_at: number; training_size: number; accuracy: number; version: number;
    }[];
    return rows.map(r => ({
      id: r.id,
      trainedAt: r.trained_at,
      trainingSize: r.training_size,
      accuracy: r.accuracy,
      version: r.version,
    }));
  } finally {
    db.close();
  }
}

export function registerCuttingBoardHandlers(): void {
  const debugLog = '/tmp/mayday-cb-debug.log';
  fs.writeFileSync(debugLog, `registerCuttingBoardHandlers called at ${new Date().toISOString()}\n`);
  try {

  ipcMain.handle('cuttingBoard:getAggregateStats', async () => {
    try {
      const result = await getAggregateStats();
      console.log('[CuttingBoard] getAggregateStats result:', result ? `${result.totalEdits} edits` : 'null');
      return result;
    } catch (err) {
      console.error('[CuttingBoard] getAggregateStats handler error:', err);
      return null;
    }
  });

  ipcMain.handle('cuttingBoard:getTrainingRuns', async () => {
    // Try local SQLite first (works in packaged app)
    try {
      const result = getTrainingRuns();
      if (result.length > 0) return result;
    } catch {
      // better-sqlite3 native module fails in dev mode — fall through to server API
    }

    // Fall back to server plugin API
    try {
      const config = loadConfig();
      const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/autocut-status`;
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.result?.model) {
          const m = data.result.model;
          return [{
            id: m.version,
            trainedAt: m.trainedAt,
            trainingSize: m.trainingSize,
            accuracy: m.accuracy,
            version: m.version,
          }];
        }
      }
    } catch (err) {
      console.error('[CuttingBoard] getTrainingRuns fallback error:', err);
    }

    return [];
  });

  ipcMain.handle('cuttingBoard:trainModel', async () => {
    const config = loadConfig();

    // Fetch training data from Supabase to augment local training data
    let joinedExamples: Array<{ editType: string; quality: string; weight: number; timestamp: number; tags: string[] }> = [];
    if (config.supabaseUrl && config.supabaseAnonKey) {
      try {
        const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);

        // Pull cut_records from Supabase (these may not exist in the local plugin DB)
        const { data: cutRows } = await supabase
          .from('cut_records')
          .select('edit_type, edit_point_time, rating, boosted, is_undo, intent_tags')
          .eq('is_undo', false);

        if (cutRows && cutRows.length > 0) {
          for (const r of cutRows) {
            const boosted = r.boosted as boolean;
            const rating = r.rating as number | null;
            const quality = boosted ? 'boosted' : rating === 1 ? 'good' : rating === 0 ? 'bad' : 'good';
            if (quality === 'bad') continue;
            joinedExamples.push({
              editType: r.edit_type as string,
              quality,
              weight: boosted ? 3.0 : 1.0,
              timestamp: r.edit_point_time as number,
              tags: Array.isArray(r.intent_tags) ? r.intent_tags as string[] : [],
            });
          }
          console.log(`[CuttingBoard] Fetched ${joinedExamples.length} cut_records from Supabase for training`);
        }

        // Also pull joined records
        const { data: joinedRows } = await supabase
          .from('cutting_board_joined')
          .select('timestamp, matched, merged_tags, model_a_rating, confidence_tier')
          .in('confidence_tier', ['high', 'medium']);

        if (joinedRows && joinedRows.length > 0) {
          const before = joinedExamples.length;
          for (const r of joinedRows) {
            const tier = r.confidence_tier as string;
            const weight = tier === 'high' ? 3.0 : 1.0;
            const rating = r.model_a_rating as string | null;
            const quality = rating === 'boost' ? 'boosted' : rating === 'bad' ? 'bad' : 'good';
            if (quality === 'bad') continue;
            joinedExamples.push({
              editType: 'cut',
              quality,
              weight,
              timestamp: r.timestamp as number,
              tags: Array.isArray(r.merged_tags) ? r.merged_tags as string[] : [],
            });
          }
          console.log(`[CuttingBoard] Added ${joinedExamples.length - before} joined examples for training`);
        }
      } catch (err) {
        console.error('[CuttingBoard] Failed to fetch Supabase training data:', err);
      }
    }

    const url = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command/train-model`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ joinedExamples }),
      });
    } catch (err) {
      const msg = `Train model fetch failed: ${(err as Error).message}`;
      fs.appendFileSync('/tmp/mayday-train-debug.log', `${new Date().toISOString()} ${msg}\n`);
      throw new Error(msg);
    }
    const rawText = await res.text();
    fs.appendFileSync('/tmp/mayday-train-debug.log', `${new Date().toISOString()} status=${res.status} body=${rawText.slice(0, 500)}\n`);
    if (!res.ok) throw new Error(`Train model failed: ${res.status}`);
    const data = JSON.parse(rawText);
    const result = data.success ? data.result : data;
    fs.appendFileSync('/tmp/mayday-train-debug.log', `${new Date().toISOString()} returning: ${JSON.stringify(result).slice(0, 200)}\n`);
    return result;
  });

  ipcMain.handle('cuttingBoard:cloudMergeTrain', async (_e, localResult: { version: number; accuracy: number; trainingSize: number }) => {
    const config = loadConfig();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      throw new Error('Supabase not configured — set URL and anon key in Settings.');
    }

    const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    const serverBase = `http://localhost:${config.serverPort}/api/plugins/cutting-board/command`;

    // 1. Get local training examples from the plugin
    const exRes = await fetch(`${serverBase}/get-training-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!exRes.ok) throw new Error('Failed to get local training examples');
    const exData = await exRes.json();
    const localExamples: Array<Record<string, unknown>> = exData.success ? exData.result : [];

    console.log(`[CloudMerge] Got ${localExamples.length} local examples`);

    // 2. Push local examples to Supabase
    if (localExamples.length > 0) {
      const rows = localExamples.map((ex: Record<string, unknown>) => ({
        machine_id: config.machineId,
        source_id: String((ex as { id?: number }).id || `local-${(ex as { timestamp?: number }).timestamp}`),
        edit_type: (ex as { editType?: string }).editType || 'cut',
        quality: (ex as { quality?: string }).quality || 'good',
        weight: (ex as { weight?: number }).weight || 1,
        context: (ex as { context?: unknown }).context || {},
        action: (ex as { action?: unknown }).action || {},
        timestamp: (ex as { timestamp?: number }).timestamp || 0,
      }));

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from('training_examples')
          .upsert(batch, { onConflict: 'machine_id,source_id' });
        if (error) console.error('[CloudMerge] Push error:', error.message);
      }
      console.log(`[CloudMerge] Pushed ${rows.length} examples to Supabase`);
    }

    // 3. Fetch ALL training examples from Supabase (all machines)
    const cloudExamples: Array<Record<string, unknown>> = [];

    // Pull from training_examples table (pushed by other machines or previous merges)
    const { data: teRows, error: fetchErr } = await supabase
      .from('training_examples')
      .select('*')
      .neq('quality', 'bad');

    if (fetchErr) console.error(`[CloudMerge] training_examples fetch error: ${fetchErr.message}`);

    for (const r of teRows ?? []) {
      cloudExamples.push({
        id: 0,
        editType: r.edit_type as string,
        quality: r.quality as string,
        weight: r.weight as number,
        context: r.context,
        action: r.action,
        timestamp: r.timestamp as number,
      });
    }

    // Also pull cut_records directly (the main source of training data)
    const { data: crRows } = await supabase
      .from('cut_records')
      .select('edit_type, edit_point_time, rating, boosted, is_undo')
      .eq('is_undo', false);

    for (const r of crRows ?? []) {
      const boosted = r.boosted as boolean;
      const rating = r.rating as number | null;
      const quality = boosted ? 'boosted' : rating === 1 ? 'good' : rating === 0 ? 'bad' : 'good';
      if (quality === 'bad') continue;
      cloudExamples.push({
        id: 0,
        editType: r.edit_type as string,
        quality,
        weight: boosted ? 3.0 : 1.0,
        context: { clipName: '', mediaPath: '', trackIndex: 0, trackType: 'video', editPointTime: r.edit_point_time as number, beforeDuration: null, afterDuration: null, neighborBefore: null, neighborAfter: null },
        action: { editType: r.edit_type as string, deltaDuration: null, deltaStart: null, deltaEnd: null, splitRatio: 0.5 },
        timestamp: (r.edit_point_time as number) * 1000,
      });
    }

    // Also pull joined records
    const { data: jRows } = await supabase
      .from('cutting_board_joined')
      .select('timestamp, model_a_rating, confidence_tier')
      .in('confidence_tier', ['high', 'medium']);

    for (const r of jRows ?? []) {
      const tier = r.confidence_tier as string;
      const rating = r.model_a_rating as string | null;
      const quality = rating === 'boost' ? 'boosted' : rating === 'bad' ? 'bad' : 'good';
      if (quality === 'bad') continue;
      cloudExamples.push({
        id: 0,
        editType: 'cut',
        quality,
        weight: tier === 'high' ? 3.0 : 1.0,
        context: { clipName: '', mediaPath: '', trackIndex: 0, trackType: 'video', editPointTime: r.timestamp as number, beforeDuration: null, afterDuration: null, neighborBefore: null, neighborAfter: null },
        action: { editType: 'cut', deltaDuration: null, deltaStart: null, deltaEnd: null, splitRatio: 0.5 },
        timestamp: (r.timestamp as number) * 1000,
      });
    }

    console.log(`[CloudMerge] Total cloud examples: ${cloudExamples.length} (${teRows?.length ?? 0} training_examples + ${crRows?.length ?? 0} cut_records + ${jRows?.length ?? 0} joined)`);

    // 4. Retrain from the combined cloud dataset
    const trainBody = JSON.stringify({ examples: cloudExamples, label: 'cloud-merge' });
    fs.appendFileSync('/tmp/mayday-train-debug.log', `${new Date().toISOString()} [CloudMerge] Sending ${cloudExamples.length} examples (${(trainBody.length / 1024).toFixed(0)}kb) to train-from-examples\n`);

    const trainRes = await fetch(`${serverBase}/train-from-examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: trainBody,
    });
    const trainRawText = await trainRes.text();
    fs.appendFileSync('/tmp/mayday-train-debug.log', `${new Date().toISOString()} [CloudMerge] train-from-examples status=${trainRes.status} body=${trainRawText.slice(0, 300)}\n`);

    if (!trainRes.ok) throw new Error(`Cloud retrain failed (${trainRes.status}): ${trainRawText.slice(0, 200)}`);
    const trainData = JSON.parse(trainRawText);
    const cloudResult = trainData.success ? trainData.result : null;

    if (!cloudResult) throw new Error(`Cloud retrain returned no result: ${trainRawText.slice(0, 200)}`);

    // 5. Push the cloud-trained model to autocut_models
    const modelRes = await fetch(`${serverBase}/get-model-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (modelRes.ok) {
      const modelData = await modelRes.json();
      if (modelData.success && modelData.result) {
        const model = modelData.result;
        await supabase
          .from('autocut_models')
          .upsert({
            machine_id: config.machineId,
            machine_name: config.machineName,
            version: model.version,
            trained_at: model.trainedAt,
            training_size: model.trainingSize,
            accuracy: model.accuracy,
            model_json: { classifier: model.classifier, regressors: model.regressors },
            uploaded_at: new Date().toISOString(),
          }, { onConflict: 'machine_id,version' });

        console.log(`[CloudMerge] Pushed cloud model v${model.version} to Supabase`);
      }
    }

    return {
      cloudAccuracy: cloudResult.accuracy,
      cloudTrainingSize: cloudResult.trainingSize,
      cloudVersion: cloudResult.version,
      localAccuracy: localResult.accuracy,
      localTrainingSize: localResult.trainingSize,
    };
  });

  ipcMain.handle('cuttingBoard:joinModels', async (_e, modelAVideoId: string, modelBVideoId: string) => {
    return runCuttingBoardJoin(modelAVideoId, modelBVideoId);
  });

  ipcMain.handle('cuttingBoard:listDatasets', async () => {
    return listAvailableDatasets();
  });

  // ── Cut Finder IPC handlers ─────────────────────────────────────────────
  // Lazily create CutFinder on first use to avoid constructor errors blocking registration

  let _progressWired = false;

  function getCutFinder(): CutFinder {
    if (!_cutFinder) {
      _cutFinder = new CutFinder();

      // Start Supabase sync for cut-finder data
      const config = loadConfig();
      if (config.supabaseUrl && config.supabaseAnonKey) {
        _cutFinderSync = new CutFinderSyncService();
        _cutFinderSync.initialize({
          supabaseUrl: config.supabaseUrl,
          supabaseAnonKey: config.supabaseAnonKey,
          machineId: config.machineId,
        });
        _cutFinderSync.startPeriodicSync(_cutFinder.database);
        console.log('[CutFinderSync] Started periodic sync');
      }
    }
    if (!_progressWired) {
      _progressWired = true;
      _cutFinder.onProgress((progress) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('cutFinder:progress', progress);
          }
        }
      });
    }
    return _cutFinder;
  }

  ipcMain.handle('cutFinder:getVideoInfo', async (_e, url: string) => {
    return getCutFinder().getVideoInfo(url);
  });

  ipcMain.handle('cutFinder:startAnalysis', async (_e, url: string) => {
    return getCutFinder().startAnalysis(url);
  });

  ipcMain.handle('cutFinder:cancelAnalysis', (_e, id: string) => {
    getCutFinder().cancelAnalysis(id);
  });

  ipcMain.handle('cutFinder:pauseAnalysis', (_e, id: string) => {
    getCutFinder().pauseAnalysis(id);
  });

  ipcMain.handle('cutFinder:resumeAnalysis', async (_e, id: string) => {
    await getCutFinder().resumeAnalysis(id);
  });

  ipcMain.handle('cutFinder:getAnalysis', (_e, id: string) => {
    return getCutFinder().getAnalysis(id);
  });

  ipcMain.handle('cutFinder:listAnalyses', () => {
    return getCutFinder().listAnalyses();
  });

  ipcMain.handle('cutFinder:deleteAnalysis', (_e, id: string) => {
    return getCutFinder().deleteAnalysis(id);
  });

  ipcMain.handle('cutFinder:getCuts', (_e, analysisId: string) => {
    return getCutFinder().getCuts(analysisId);
  });

  ipcMain.handle('cutFinder:getFrames', (_e, analysisId: string) => {
    return getCutFinder().getFrames(analysisId);
  });

  ipcMain.handle('cutFinder:setIntentTags', (_e, cutId: string, tags: string[]) => {
    getCutFinder().setIntentTags(cutId, tags);
  });

  ipcMain.handle('cutFinder:export', (_e, options: CutFinderExportOptions) => {
    return getCutFinder().exportAnalysis(options);
  });

  ipcMain.handle('cutFinder:syncToSupabase', async () => {
    getCutFinder(); // ensure initialized
    if (_cutFinderSync) {
      const pushed = await _cutFinderSync.pushCuts(getCutFinder().database);
      return { pushed };
    }
    return { pushed: 0, error: 'Supabase not configured' };
  });

  fs.appendFileSync(debugLog, `All handlers registered OK\n`);
  } catch (err) {
    fs.appendFileSync(debugLog, `ERROR: ${(err as Error).stack || err}\n`);
  }
}
