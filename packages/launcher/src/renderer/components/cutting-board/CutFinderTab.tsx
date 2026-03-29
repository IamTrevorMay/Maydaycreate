import React, { useState, useEffect, useCallback, useRef } from 'react';
import { c } from '../../styles.js';
import { useIpc } from '../../hooks/useIpc.js';
import type { CutFinderAnalysisSummary, CutFinderProgress, DetectedCut, CuttingBoardJoinResult } from '@mayday/types';
import {
  INTENT_TAGS,
  CONFIDENCE_COLORS,
  Section,
  formatTimecode,
} from './shared.js';

export function CutFinderTab(): React.ReactElement {
  return (
    <div style={{ padding: 20, maxWidth: 700 }}>
      <CutFinderSection />
      <JoinModelsSection />
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
  const [modelADatasets, setModelADatasets] = useState<Array<{ videoId: string; count: number }>>([]);
  const [modelBDatasets, setModelBDatasets] = useState<Array<{ videoId: string; count: number }>>([]);
  const [selectedA, setSelectedA] = useState('');
  const [selectedB, setSelectedB] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CuttingBoardJoinResult | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load available datasets on mount and after sync
  const loadDatasets = useCallback(async () => {
    try {
      const ds = await ipc.cuttingBoard.listDatasets();
      setModelADatasets(ds.modelA);
      setModelBDatasets(ds.modelB);
    } catch {
      // Supabase may not be configured
    } finally {
      setLoading(false);
    }
  }, [ipc]);

  useEffect(() => { loadDatasets(); }, [loadDatasets]);

  // Auto-select Model B when a cut-finder analysis completes (pick first available)
  useEffect(() => {
    if (modelBDatasets.length > 0 && !selectedB) {
      setSelectedB(modelBDatasets[0].videoId);
    }
  }, [modelBDatasets, selectedB]);

  const runJoin = useCallback(async () => {
    if (!selectedA || !selectedB) return;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      // Sync cut-finder data to Supabase first
      setSyncing(true);
      try {
        await ipc.cutFinder.syncToSupabase();
      } catch {}
      setSyncing(false);

      // Refresh datasets in case sync added new data
      await loadDatasets();

      const r = await ipc.cuttingBoard.joinModels(selectedA, selectedB);
      setResult(r);
    } catch (err) {
      setError((err as Error).message || 'Join failed');
    } finally {
      setRunning(false);
      setSyncing(false);
    }
  }, [selectedA, selectedB, ipc, loadDatasets]);

  const canJoin = selectedA && selectedB && !running;
  const total = result ? result.matched + result.unmatchedA + result.unmatchedB : 0;

  const selectStyle: React.CSSProperties = {
    flex: 1,
    padding: '6px 10px',
    background: c.bg.tertiary,
    border: `1px solid ${c.border.default}`,
    borderRadius: 4,
    color: c.text.primary,
    fontSize: 12,
    outline: 'none',
    appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    cursor: 'pointer',
  };

  return (
    <Section title="Join Models">
      {loading ? (
        <div style={{ fontSize: 11, color: c.text.disabled }}>Loading datasets from Supabase...</div>
      ) : (
        <>
          {/* Pairing selectors */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
            {/* Model B (Finder) — auto-populated from analyses */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: c.text.secondary, marginBottom: 3 }}>Finder (video analysis)</div>
              {modelBDatasets.length > 0 ? (
                <select
                  value={selectedB}
                  onChange={e => setSelectedB(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select...</option>
                  {modelBDatasets.map(d => (
                    <option key={d.videoId} value={d.videoId}>{d.videoId} ({d.count} cuts)</option>
                  ))}
                </select>
              ) : (
                <div style={{ ...selectStyle, color: c.text.disabled, cursor: 'default' }}>No analyses synced yet</div>
              )}
            </div>

            <span style={{ color: c.text.disabled, fontSize: 14, paddingTop: 14 }}>{'\u2194'}</span>

            {/* Model A (Watcher) — dropdown of available datasets */}
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, color: c.text.secondary, marginBottom: 3 }}>Watcher (live edits)</div>
              {modelADatasets.length > 0 ? (
                <select
                  value={selectedA}
                  onChange={e => setSelectedA(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">Select...</option>
                  {modelADatasets.map(d => (
                    <option key={d.videoId} value={d.videoId}>{d.videoId} ({d.count} cuts)</option>
                  ))}
                </select>
              ) : (
                <div style={{ ...selectStyle, color: c.text.disabled, cursor: 'default' }}>No watcher data yet</div>
              )}
            </div>

            <button
              onClick={runJoin}
              disabled={!canJoin}
              style={{
                padding: '6px 16px',
                marginTop: 14,
                background: canJoin ? c.accent.primary : c.bg.tertiary,
                color: canJoin ? '#fff' : c.text.disabled,
                border: 'none',
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 600,
                cursor: canJoin ? 'pointer' : 'default',
                flexShrink: 0,
              }}
            >
              {syncing ? 'Syncing...' : running ? 'Joining...' : 'Join'}
            </button>
          </div>

          {error && <div style={{ color: c.status.error, fontSize: 11, marginBottom: 8 }}>{error}</div>}

          {result && (
            <div>
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
                        title={`High: ${result.matched} matched`}
                      >
                        high
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
                Watcher ({result.modelAVideoId}): {result.totalModelA} cuts | Finder ({result.modelBVideoId}): {result.totalModelB} cuts
              </div>
            </div>
          )}

          {!result && !running && (modelADatasets.length > 0 || modelBDatasets.length > 0) && (
            <div style={{ fontSize: 11, color: c.text.disabled }}>
              Select a Finder analysis and a Watcher dataset to pair, then click Join.
            </div>
          )}

          {!result && !running && modelADatasets.length === 0 && modelBDatasets.length === 0 && (
            <div style={{ fontSize: 11, color: c.text.disabled }}>
              Analyze a video in Cut Finder and record edits in Premiere to create datasets for joining.
            </div>
          )}
        </>
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
