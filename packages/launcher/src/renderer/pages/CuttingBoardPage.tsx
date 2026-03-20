import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c } from '../styles.js';
import { useIpc } from '../hooks/useIpc.js';
import { useCuttingBoard } from '../hooks/useCuttingBoard.js';
import { INTENT_TAGS } from '@mayday/types';
import type { CutFinderAnalysisSummary, CutFinderProgress, DetectedCut, CuttingBoardJoinResult } from '@mayday/types';

const EDIT_TYPE_COLORS: Record<string, string> = {
  cut: '#2680eb',
  'trim-head': '#a855f7',
  'trim-tail': '#ec4899',
  delete: '#f87171',
  move: '#fbbf24',
  add: '#4ade80',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  high: '#4ade80',
  medium: '#fbbf24',
  low: '#f87171',
};

export function CuttingBoardPage(): React.ReactElement {
  const { stats, trainingRuns, training, trainModel } = useCuttingBoard();

  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      {/* Cut Finder — always visible */}
      <CutFinderSection />

      {/* Join Models */}
      <JoinModelsSection />

      {/* Cut-watcher stats below */}
      {stats && <CutWatcherStats stats={stats} trainingRuns={trainingRuns} training={training} trainModel={trainModel} />}

      {!stats && (
        <Section title="Cut-Watcher">
          <div style={{ color: c.text.secondary, fontSize: 12 }}>
            No live editing data yet. Use Cutting Board in Premiere Pro to start recording edits.
          </div>
        </Section>
      )}
    </div>
  );
}

// ── Cut Finder Section ────────────────────────────────────────────────────

function CutFinderSection(): React.ReactElement {
  const ipc = useIpc();
  const [url, setUrl] = useState('');
  const [analyses, setAnalyses] = useState<CutFinderAnalysisSummary[]>([]);
  const [progress, setProgress] = useState<CutFinderProgress | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<DetectedCut[]>([]);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const refreshTimer = useRef<ReturnType<typeof setInterval>>();

  const refreshAnalyses = useCallback(async () => {
    try {
      const list = await ipc.cutFinder.listAnalyses();
      setAnalyses(list);
    } catch {}
  }, [ipc]);

  useEffect(() => {
    refreshAnalyses();
    refreshTimer.current = setInterval(refreshAnalyses, 5000);
    return () => clearInterval(refreshTimer.current);
  }, [refreshAnalyses]);

  useEffect(() => {
    const unsub = ipc.cutFinder.onProgress((p) => {
      setProgress(p);
      if (p.status === 'complete' || p.status === 'error' || p.status === 'cancelled') {
        refreshAnalyses();
        setTimeout(() => setProgress(null), 3000);
      }
    });
    return unsub;
  }, [ipc, refreshAnalyses]);

  // Load cuts when an analysis is selected; init reviewed set from existing tags
  useEffect(() => {
    if (!selectedId) { setCuts([]); setReviewedIds(new Set()); return; }
    ipc.cutFinder.getCuts(selectedId).then(loaded => {
      setCuts(loaded);
      // Pre-mark cuts that already have tags as reviewed
      const alreadyReviewed = new Set<string>();
      for (const ct of loaded) {
        if (ct.intentTags && ct.intentTags.length > 0) alreadyReviewed.add(ct.id);
      }
      setReviewedIds(alreadyReviewed);
    }).catch(() => { setCuts([]); setReviewedIds(new Set()); });
  }, [selectedId, ipc]);

  const startAnalysis = useCallback(async () => {
    if (!url.trim()) return;
    setError('');
    try {
      await ipc.cutFinder.startAnalysis(url.trim());
      setUrl('');
    } catch (err) {
      setError((err as Error).message || 'Failed to start analysis');
    }
  }, [url, ipc]);

  const deleteAnalysis = useCallback(async (id: string) => {
    await ipc.cutFinder.deleteAnalysis(id);
    if (selectedId === id) { setSelectedId(null); setCuts([]); setReviewedIds(new Set()); }
    refreshAnalyses();
  }, [ipc, selectedId, refreshAnalyses]);

  const markReviewed = useCallback((cutId: string) => {
    setReviewedIds(prev => new Set(prev).add(cutId));
  }, []);

  const reviewedCount = reviewedIds.size;
  const totalCuts = cuts.length;
  const reviewPct = totalCuts > 0 ? Math.round((reviewedCount / totalCuts) * 100) : 0;

  return (
    <Section title="Cut Finder">
      {/* URL input */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && startAnalysis()}
          placeholder="Paste a YouTube URL..."
          style={{
            flex: 1,
            padding: '6px 10px',
            background: c.bg.tertiary,
            border: `1px solid ${c.border.default}`,
            borderRadius: 4,
            color: c.text.primary,
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          onClick={startAnalysis}
          disabled={!url.trim()}
          style={{
            padding: '6px 16px',
            background: url.trim() ? c.accent.primary : c.bg.tertiary,
            color: url.trim() ? '#fff' : c.text.disabled,
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: url.trim() ? 'pointer' : 'default',
          }}
        >
          Analyze
        </button>
      </div>

      {error && <div style={{ color: c.status.error, fontSize: 11, marginBottom: 8 }}>{error}</div>}

      {/* Download/detection progress bar */}
      {progress && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: c.text.secondary }}>{progress.phase}</span>
            <span style={{ fontSize: 10, color: c.text.secondary }}>{progress.percent}%</span>
          </div>
          <div style={{ height: 6, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${progress.percent}%`,
              background: progress.status === 'error' ? c.status.error : c.accent.primary,
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          </div>
          {progress.detail && <div style={{ fontSize: 10, color: c.text.disabled, marginTop: 2 }}>{progress.detail}</div>}
        </div>
      )}

      {/* Analyses list with review progress */}
      {analyses.length > 0 && (
        <div style={{ marginBottom: cuts.length > 0 ? 12 : 0 }}>
          {analyses.map(a => {
            const isSelected = selectedId === a.id;
            const showReviewProgress = isSelected && totalCuts > 0;
            return (
              <div key={a.id}>
                <div
                  onClick={() => setSelectedId(isSelected ? null : a.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    background: isSelected ? c.bg.hover : 'transparent',
                    borderRadius: 4,
                    cursor: 'pointer',
                    marginBottom: 0,
                  }}
                >
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: a.status === 'complete' ? c.status.success
                      : a.status === 'error' ? c.status.error
                      : a.status === 'cancelled' ? c.text.disabled
                      : c.accent.primary,
                  }} />

                  <span style={{ flex: 1, fontSize: 12, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.title || 'Untitled'}
                  </span>

                  {/* Review progress bar next to title */}
                  {showReviewProgress && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <div style={{ width: 60, height: 5, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%',
                          width: `${reviewPct}%`,
                          background: reviewPct === 100 ? c.status.success : '#a855f7',
                          borderRadius: 3,
                          transition: 'width 0.3s',
                        }} />
                      </div>
                      <span style={{ fontSize: 9, color: reviewPct === 100 ? c.status.success : c.text.disabled, fontWeight: 600 }}>
                        {reviewedCount}/{totalCuts}
                      </span>
                    </div>
                  )}

                  {a.status === 'complete' && !showReviewProgress && (
                    <span style={{ fontSize: 11, color: c.text.secondary }}>{a.cutCount} cuts</span>
                  )}

                  {a.status !== 'complete' && (
                    <span style={{ fontSize: 10, color: c.text.disabled }}>{a.status}</span>
                  )}

                  <span style={{ fontSize: 10, color: c.text.disabled, width: 40, textAlign: 'right' }}>
                    {a.duration > 0 ? `${Math.floor(a.duration / 60)}:${String(Math.floor(a.duration % 60)).padStart(2, '0')}` : ''}
                  </span>

                  <button
                    onClick={e => { e.stopPropagation(); deleteAnalysis(a.id); }}
                    style={{
                      background: 'none', border: 'none', color: c.text.disabled,
                      cursor: 'pointer', fontSize: 14, padding: '0 4px', lineHeight: 1,
                    }}
                    title="Delete"
                  >
                    x
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detected cuts list with tag review */}
      {cuts.length > 0 && selectedId && (
        <div>
          <div style={{ fontSize: 11, color: c.text.secondary, fontWeight: 600, marginBottom: 6 }}>
            Detected Cuts ({cuts.length}) — expand to review, tag or skip each cut
          </div>
          <div style={{ maxHeight: 500, overflowY: 'scroll', overflowX: 'visible', position: 'relative' }}>
            {cuts.map(cut => (
              <CutRow
                key={cut.id}
                cut={cut}
                ipc={ipc}
                reviewed={reviewedIds.has(cut.id)}
                onReviewed={() => markReviewed(cut.id)}
                onUpdated={() => {
                  ipc.cutFinder.getCuts(selectedId).then(setCuts).catch(() => {});
                }}
              />
            ))}
          </div>
        </div>
      )}

      {analyses.length === 0 && !progress && (
        <div style={{ color: c.text.disabled, fontSize: 11 }}>
          Paste a YouTube URL above to detect cuts in a finished video.
        </div>
      )}
    </Section>
  );
}

// ── Join Models Section ───────────────────────────────────────────────────

function JoinModelsSection(): React.ReactElement {
  const ipc = useIpc();
  const [videoId, setVideoId] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CuttingBoardJoinResult | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);

  const runJoin = useCallback(async () => {
    if (!videoId.trim()) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      // Sync cut-finder data to Supabase first
      setSyncing(true);
      try {
        await ipc.cutFinder.syncToSupabase();
      } catch {
        // Sync may fail if Supabase isn't configured — continue with join anyway
      }
      setSyncing(false);

      const r = await ipc.cuttingBoard.joinModels(videoId.trim());
      setResult(r);
    } catch (err) {
      setError((err as Error).message || 'Join failed');
    } finally {
      setRunning(false);
      setSyncing(false);
    }
  }, [videoId, ipc]);

  const total = result ? result.matched + result.unmatchedA + result.unmatchedB : 0;

  return (
    <Section title="Join Models">
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type="text"
          value={videoId}
          onChange={e => setVideoId(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runJoin()}
          placeholder="Video ID (e.g. dQw4w9WgXcQ or ep047)"
          style={{
            flex: 1,
            padding: '6px 10px',
            background: c.bg.tertiary,
            border: `1px solid ${c.border.default}`,
            borderRadius: 4,
            color: c.text.primary,
            fontSize: 12,
            outline: 'none',
          }}
        />
        <button
          onClick={runJoin}
          disabled={!videoId.trim() || running}
          style={{
            padding: '6px 16px',
            background: videoId.trim() && !running ? c.accent.primary : c.bg.tertiary,
            color: videoId.trim() && !running ? '#fff' : c.text.disabled,
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: videoId.trim() && !running ? 'pointer' : 'default',
          }}
        >
          {syncing ? 'Syncing...' : running ? 'Joining...' : 'Join'}
        </button>
      </div>

      {error && <div style={{ color: c.status.error, fontSize: 11, marginBottom: 8 }}>{error}</div>}

      {result && (
        <div>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.status.success }}>{result.matched}</div>
              <div style={{ fontSize: 9, color: c.text.secondary }}>Matched</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.text.primary }}>{result.unmatchedA}</div>
              <div style={{ fontSize: 9, color: c.text.secondary }}>Watcher only</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.text.primary }}>{result.unmatchedB}</div>
              <div style={{ fontSize: 9, color: c.text.secondary }}>Finder only</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: c.accent.primary }}>{result.written}</div>
              <div style={{ fontSize: 9, color: c.text.secondary }}>Written</div>
            </div>
          </div>

          {/* Confidence tier breakdown */}
          {total > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: c.text.secondary, marginBottom: 4 }}>Confidence Tiers</div>
              <div style={{ display: 'flex', height: 20, borderRadius: 4, overflow: 'hidden' }}>
                {result.matched > 0 && (
                  <div
                    style={{
                      flex: result.matched,
                      background: c.status.success,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#000', fontWeight: 600,
                    }}
                    title={`High: ${result.matched} matched with tags`}
                  >
                    {result.matched > 0 ? 'high' : ''}
                  </div>
                )}
                {(result.unmatchedA + result.unmatchedB) > 0 && (
                  <div
                    style={{
                      flex: result.unmatchedA + result.unmatchedB,
                      background: c.status.warning,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#000', fontWeight: 600,
                    }}
                    title={`Medium/Low: ${result.unmatchedA + result.unmatchedB} unmatched`}
                  >
                    med/low
                  </div>
                )}
              </div>
            </div>
          )}

          <div style={{ fontSize: 10, color: c.text.disabled }}>
            Model A: {result.totalModelA} cuts from live editing | Model B: {result.totalModelB} cuts from video analysis
          </div>
        </div>
      )}

      {!result && !running && (
        <div style={{ fontSize: 11, color: c.text.disabled }}>
          Enter a video ID to match cuts from both models and write joined records to Supabase.
        </div>
      )}
    </Section>
  );
}

// ── Cut Row with Tag Picker ────────────────────────────────────────────────

function CutRow({ cut, ipc, reviewed, onReviewed, onUpdated }: {
  cut: DetectedCut;
  ipc: ReturnType<typeof useIpc>;
  reviewed: boolean;
  onReviewed: () => void;
  onUpdated: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tags, setTags] = useState<string[]>(cut.intentTags ?? []);
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tagOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setTagOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [tagOpen]);

  const toggleTag = useCallback((tagId: string) => {
    setTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  }, []);

  const saveTags = useCallback(async () => {
    setSaving(true);
    try {
      await ipc.cutFinder.setIntentTags(cut.id, tags);
      onReviewed();
      onUpdated();
    } catch (err) {
      console.error('Failed to save tags:', err);
    } finally {
      setSaving(false);
      setTagOpen(false);
    }
  }, [ipc, cut.id, tags, onReviewed, onUpdated]);

  const skipCut = useCallback(() => {
    onReviewed();
    setExpanded(false);
  }, [onReviewed]);

  const hasChanges = JSON.stringify(tags) !== JSON.stringify(cut.intentTags ?? []);
  const frameUrl = (p: string) => `mayday-frame://${encodeURIComponent(p)}`;

  return (
    <div style={{
      borderTop: `1px solid ${c.border.default}`,
      borderLeft: reviewed ? `3px solid ${c.status.success}` : '3px solid transparent',
      paddingLeft: 4,
      transition: 'border-color 0.3s',
    }}>
      {/* Summary row — click to expand */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer' }}
      >
        <span style={{ fontSize: 10, color: reviewed ? c.status.success : c.text.disabled, width: 12, flexShrink: 0 }}>
          {reviewed ? '\u2713' : expanded ? '\u25BC' : '\u25B6'}
        </span>

        <span style={{ fontSize: 12, color: c.text.primary, fontFamily: 'monospace', width: 60, flexShrink: 0 }}>
          {formatTimecode(cut.timestamp)}
        </span>

        <span style={{
          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3, flexShrink: 0,
          background: CONFIDENCE_COLORS[cut.confidence] + '22',
          color: CONFIDENCE_COLORS[cut.confidence],
        }}>
          {cut.confidence}
        </span>

        <span style={{ fontSize: 10, color: c.text.disabled, flexShrink: 0 }}>
          {(cut.diffScore * 100).toFixed(0)}%
        </span>

        {/* Tag button */}
        <div ref={dropdownRef} style={{ position: 'relative', flex: 1, minWidth: 0 }} onClick={e => e.stopPropagation()}>
          <button
            onClick={() => setTagOpen(o => !o)}
            style={{
              background: tags.length > 0 ? '#1e3a5f' : c.bg.tertiary,
              border: `1px solid ${tags.length > 0 ? '#2680eb44' : c.border.default}`,
              borderRadius: 3,
              padding: '2px 8px',
              cursor: 'pointer',
              fontSize: 10,
              color: tags.length > 0 ? '#93c5fd' : c.text.disabled,
              fontWeight: tags.length > 0 ? 600 : 400,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: '100%',
              textAlign: 'left',
            }}
          >
            {tags.length > 0
              ? tags.map(id => INTENT_TAGS.find(t => t.id === id)?.label || id).join(', ')
              : '+ Tag'}
          </button>

          {tagOpen && (
            <div style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              marginBottom: 4,
              background: '#1e1e2e',
              border: '1px solid #444',
              borderRadius: 6,
              padding: 6,
              minWidth: 200,
              boxShadow: '0 -4px 16px rgba(0,0,0,0.5)',
              zIndex: 300,
            }}>
              {INTENT_TAGS.map(tag => {
                const active = tags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    onClick={() => toggleTag(tag.id)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '5px 8px',
                      background: active ? '#1e3a5f' : 'transparent',
                      border: 'none',
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontSize: 11,
                      color: active ? '#93c5fd' : '#ccc',
                      fontWeight: active ? 600 : 400,
                      textAlign: 'left',
                      marginBottom: 2,
                    }}
                  >
                    {active ? '\u2713 ' : ''}{tag.label}
                  </button>
                );
              })}

              <button
                onClick={saveTags}
                disabled={saving}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '5px 8px',
                  marginTop: 4,
                  background: hasChanges ? '#2680eb' : '#333',
                  border: 'none',
                  borderRadius: 3,
                  cursor: hasChanges ? 'pointer' : 'default',
                  fontSize: 10,
                  color: hasChanges ? '#fff' : '#666',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                {saving ? 'Saving...' : hasChanges ? 'Save' : 'Close'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Expanded: before/after frames + skip */}
      {expanded && (
        <div style={{ padding: '4px 0 10px 20px' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: c.text.disabled, marginBottom: 3 }}>Before</div>
              {cut.frameBefore ? (
                <img
                  src={frameUrl(cut.frameBefore)}
                  style={{ width: '100%', borderRadius: 4, border: `1px solid ${c.border.default}` }}
                  alt="Before"
                />
              ) : (
                <div style={{ height: 80, background: c.bg.tertiary, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text.disabled, fontSize: 10 }}>No frame</div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', color: c.text.disabled, fontSize: 16, flexShrink: 0 }}>
              {'\u2192'}
            </div>
            <div style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: 9, color: c.text.disabled, marginBottom: 3 }}>After</div>
              {cut.frameAfter ? (
                <img
                  src={frameUrl(cut.frameAfter)}
                  style={{ width: '100%', borderRadius: 4, border: `1px solid ${c.border.default}` }}
                  alt="After"
                />
              ) : (
                <div style={{ height: 80, background: c.bg.tertiary, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.text.disabled, fontSize: 10 }}>No frame</div>
              )}
            </div>
          </div>
          {!reviewed && (
            <button
              onClick={e => { e.stopPropagation(); skipCut(); }}
              style={{
                padding: '4px 14px',
                background: c.bg.tertiary,
                border: `1px solid ${c.border.default}`,
                borderRadius: 3,
                color: c.text.secondary,
                fontSize: 10,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Skip — no context to give
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Cut-Watcher Stats ─────────────────────────────────────────────────────

function CutWatcherStats({ stats, trainingRuns, training, trainModel }: {
  stats: NonNullable<ReturnType<typeof useCuttingBoard>['stats']>;
  trainingRuns: ReturnType<typeof useCuttingBoard>['trainingRuns'];
  training: boolean;
  trainModel: () => void;
}): React.ReactElement {
  const maxTypeCount = Math.max(1, ...Object.values(stats.editsByType));
  const latestRun = trainingRuns[0] ?? null;

  return (
    <>
      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 20 }}>
        <StatCard label="Total Edits" value={stats.totalEdits} />
        <StatCard label="Sessions" value={stats.totalSessions} />
        <StatCard label="Approval" value={stats.approvalRate != null ? `${Math.round(stats.approvalRate * 100)}%` : '—'} color={stats.approvalRate != null && stats.approvalRate >= 0.7 ? c.status.success : undefined} />
        <StatCard label="Tagged" value={Object.values(stats.tagCounts || {}).reduce((s, n) => s + n, 0)} color="#a855f7" />
        <StatCard label="Undo Rate" value={`${Math.round(stats.undoRate * 100)}%`} color={stats.undoRate > 0.15 ? c.status.error : c.text.primary} />
      </div>

      {/* Edit type breakdown */}
      {Object.keys(stats.editsByType).length > 0 && (
        <Section title="Edit Type Breakdown">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(stats.editsByType)
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 70, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{type}</span>
                  <div style={{ flex: 1, height: 18, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${(count / maxTypeCount) * 100}%`,
                      background: EDIT_TYPE_COLORS[type] || c.accent.primary,
                      borderRadius: 3,
                      minWidth: 4,
                    }} />
                  </div>
                  <span style={{ width: 32, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{count}</span>
                </div>
              ))}
          </div>
        </Section>
      )}

      {/* Intent tag breakdown */}
      {stats.tagCounts && Object.keys(stats.tagCounts).length > 0 && (() => {
        const maxTagCount = Math.max(1, ...Object.values(stats.tagCounts));
        return (
          <Section title="Intent Tags">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {INTENT_TAGS
                .filter(tag => (stats.tagCounts[tag.id] || 0) > 0)
                .sort((a, b) => (stats.tagCounts[b.id] || 0) - (stats.tagCounts[a.id] || 0))
                .map(tag => (
                  <div key={tag.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 120, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{tag.label}</span>
                    <div style={{ flex: 1, height: 18, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${((stats.tagCounts[tag.id] || 0) / maxTagCount) * 100}%`,
                        background: '#a855f7',
                        borderRadius: 3,
                        minWidth: 4,
                      }} />
                    </div>
                    <span style={{ width: 32, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>{stats.tagCounts[tag.id]}</span>
                  </div>
                ))}
            </div>
          </Section>
        );
      })()}

      {/* Approval bar */}
      {(stats.thumbsUp > 0 || stats.thumbsDown > 0) && (
        <Section title="Approval">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: c.status.success }}>+{stats.thumbsUp}</span>
            <div style={{ flex: 1, height: 14, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
              <div style={{ height: '100%', width: `${(stats.thumbsUp / (stats.thumbsUp + stats.thumbsDown)) * 100}%`, background: c.status.success }} />
              <div style={{ height: '100%', flex: 1, background: c.status.error }} />
            </div>
            <span style={{ fontSize: 12, color: c.status.error }}>-{stats.thumbsDown}</span>
          </div>
        </Section>
      )}

      {/* Recent sessions */}
      {stats.recentSessions.length > 0 && (
        <Section title="Recent Sessions">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: c.text.secondary, textAlign: 'left' }}>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Sequence</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Date</th>
                <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Edits</th>
                <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Approval</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSessions.map(s => (
                <tr key={s.id} style={{ borderTop: `1px solid ${c.border.default}` }}>
                  <td style={{ padding: '6px 8px', color: c.text.primary }}>{s.sequenceName}</td>
                  <td style={{ padding: '6px 8px', color: c.text.secondary }}>{new Date(s.startedAt).toLocaleDateString()}</td>
                  <td style={{ padding: '6px 8px', color: c.text.primary, textAlign: 'right' }}>{s.totalEdits}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: s.approvalRate != null && s.approvalRate >= 0.7 ? c.status.success : c.text.secondary }}>
                    {s.approvalRate != null ? `${Math.round(s.approvalRate * 100)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Model training */}
      <Section title="Model Training">
        {latestRun ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <MiniStat label="Version" value={`v${latestRun.version}`} />
            <MiniStat label="Accuracy" value={`${Math.round(latestRun.accuracy * 100)}%`} color={latestRun.accuracy >= 0.7 ? c.status.success : c.status.warning} />
            <MiniStat label="Training Size" value={latestRun.trainingSize} />
            <MiniStat label="Trained" value={formatRelativeTime(latestRun.trainedAt)} />
          </div>
        ) : (
          <div style={{ color: c.text.secondary, fontSize: 12, marginBottom: 12 }}>No model trained yet.</div>
        )}

        <button
          onClick={trainModel}
          disabled={training}
          style={{
            padding: '8px 20px',
            background: training ? c.bg.tertiary : c.accent.primary,
            color: training ? c.text.disabled : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: training ? 'default' : 'pointer',
            marginBottom: training ? 8 : 16,
          }}
        >
          {training ? 'Training...' : 'Train Model'}
        </button>
        {training && <TrainingProgress />}

        {trainingRuns.length > 0 && (
          <div>
            <div style={{ color: c.text.secondary, fontSize: 11, fontWeight: 600, marginBottom: 6 }}>History</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: c.text.secondary, textAlign: 'left' }}>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Version</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600 }}>Date</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Size</th>
                  <th style={{ padding: '4px 8px', fontWeight: 600, textAlign: 'right' }}>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {trainingRuns.map(run => (
                  <tr key={run.id} style={{ borderTop: `1px solid ${c.border.default}` }}>
                    <td style={{ padding: '6px 8px', color: c.text.primary }}>v{run.version}</td>
                    <td style={{ padding: '6px 8px', color: c.text.secondary }}>{new Date(run.trainedAt).toLocaleDateString()}</td>
                    <td style={{ padding: '6px 8px', color: c.text.primary, textAlign: 'right' }}>{run.trainingSize}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', color: run.accuracy >= 0.7 ? c.status.success : c.status.warning }}>
                      {Math.round(run.accuracy * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

// ── Shared Components ─────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      padding: 14,
      border: `1px solid ${c.border.default}`,
      textAlign: 'center',
    }}>
      <div style={{ color: color || c.text.primary, fontSize: 22, fontWeight: 700, marginBottom: 2 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ color: color || c.text.primary, fontSize: 14, fontWeight: 600 }}>{value}</div>
      <div style={{ color: c.text.secondary, fontSize: 10 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      border: `1px solid ${c.border.default}`,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ color: c.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

function TrainingProgress(): React.ReactElement {
  const [pct, setPct] = React.useState(0);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setPct(prev => {
        if (prev >= 95) return 95;
        const increment = prev < 50 ? 4 : prev < 80 ? 2 : 0.5;
        return Math.min(95, prev + increment);
      });
    }, 200);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: c.text.secondary }}>Training neural network...</span>
        <span style={{ fontSize: 10, color: c.text.secondary }}>{Math.round(pct)}%</span>
      </div>
      <div style={{ height: 6, background: c.bg.tertiary, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: c.accent.primary,
          borderRadius: 3,
          transition: 'width 0.2s',
        }} />
      </div>
    </div>
  );
}

function formatTimecode(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
