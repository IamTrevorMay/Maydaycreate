import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { c } from '../styles.js';
import { useYouTube } from '../hooks/useYouTube.js';
import { VideoInput } from '../components/youtube/VideoInput.js';
import { AnalysisProgress } from '../components/youtube/AnalysisProgress.js';
import { EffectTimeline, CATEGORY_COLORS } from '../components/youtube/EffectTimeline.js';
import { EffectDetail } from '../components/youtube/EffectDetail.js';
import { AnalysisCard } from '../components/youtube/AnalysisCard.js';
import { BatchQueue } from '../components/youtube/BatchQueue.js';
import type { DetectedEffect, EffectCategory } from '@mayday/types';

type Tab = 'analyze' | 'queue' | 'library' | 'training';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'queue', label: 'Queue' },
  { id: 'library', label: 'Library' },
  { id: 'training', label: 'Training' },
];

const RATING_BAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#84cc16', '#22c55e'];

export function YouTubePage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('analyze');
  const [selectedEffect, setSelectedEffect] = useState<DetectedEffect | null>(null);
  const [activeCategories, setActiveCategories] = useState<Set<EffectCategory>>(new Set());
  const [viewMode, setViewMode] = useState<'timeline' | 'list'>('timeline');
  const [skipCuts, setSkipCuts] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const prevAnalysisIdRef = useRef<string | null>(null);
  const yt = useYouTube();

  // Sync selectedEffect with updated effects array (fixes stale rating display)
  useEffect(() => {
    if (selectedEffect) {
      const updated = yt.effects.find(e => e.id === selectedEffect.id);
      if (updated && updated !== selectedEffect) {
        setSelectedEffect(updated);
      }
    }
  }, [yt.effects]);

  const isAnalyzing = yt.progress && yt.progress.status !== 'complete' && yt.progress.status !== 'error' && yt.progress.status !== 'cancelled';
  const isPaused = yt.progress?.status === 'paused';

  // Reset activeCategories when currentAnalysis changes
  useEffect(() => {
    const currentId = yt.currentAnalysis?.id || null;
    if (currentId !== prevAnalysisIdRef.current) {
      prevAnalysisIdRef.current = currentId;
      if (yt.effects.length > 0) {
        const cats = new Set<EffectCategory>();
        for (const e of yt.effects) cats.add(e.category);
        setActiveCategories(cats);
      } else {
        setActiveCategories(new Set());
      }
      setSelectedEffect(null);
    }
  }, [yt.currentAnalysis?.id, yt.effects]);

  // Ensure activeCategories are populated when effects load after analysis
  useEffect(() => {
    if (activeCategories.size === 0 && yt.effects.length > 0) {
      const cats = new Set<EffectCategory>();
      for (const e of yt.effects) cats.add(e.category);
      setActiveCategories(cats);
    }
  }, [yt.effects, activeCategories.size]);

  // Filtered effects
  const filteredEffects = useMemo(
    () => yt.effects.filter(e => activeCategories.has(e.category)),
    [yt.effects, activeCategories],
  );

  // Selected index in filteredEffects
  const selectedIndex = useMemo(
    () => selectedEffect ? filteredEffects.findIndex(e => e.id === selectedEffect.id) : -1,
    [filteredEffects, selectedEffect],
  );

  const handleToggleCategory = useCallback((cat: EffectCategory) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  }, []);

  const handlePrev = useCallback(() => {
    if (selectedIndex > 0) {
      setSelectedEffect(filteredEffects[selectedIndex - 1]);
    }
  }, [filteredEffects, selectedIndex]);

  const handleNext = useCallback(() => {
    if (selectedIndex < filteredEffects.length - 1) {
      setSelectedEffect(filteredEffects[selectedIndex + 1]);
    }
  }, [filteredEffects, selectedIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if typing in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      // 1-5 keys to rate
      if (e.key >= '1' && e.key <= '5' && selectedEffect) {
        e.preventDefault();
        yt.rateEffect(selectedEffect.id, parseInt(e.key));
      }

      // Arrow keys to navigate
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handlePrev();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleNext();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedEffect, handlePrev, handleNext, yt]);

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
            {t.id === 'queue' && yt.queue.length > 0 && (
              <span style={{
                marginLeft: 6,
                padding: '0 5px',
                background: c.bg.elevated,
                borderRadius: 8,
                fontSize: 10,
              }}>
                {yt.queue.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Persistent control bar for Analyze tab */}
      {tab === 'analyze' && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 20px',
          background: c.bg.elevated,
          borderBottom: `1px solid ${c.border.default}`,
          flexShrink: 0,
        }}>
          {/* Left: Skip Cuts */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={skipCuts}
                onChange={(e) => setSkipCuts(e.target.checked)}
                style={{ accentColor: c.accent.primary }}
              />
              <span style={{ color: c.text.primary, fontSize: 12, fontWeight: 600 }}>Skip Cuts</span>
            </label>
            <span style={{ color: c.text.disabled, fontSize: 10 }}>
              Ignore simple cuts during analysis
            </span>
          </div>

          {/* Right: analysis progress + PAUSE when active */}
          {yt.progress && (isAnalyzing || isPaused) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: c.text.secondary, fontSize: 11 }}>
                {yt.progress.detail}
              </span>
              <span style={{
                color: isPaused ? '#fbbf24' : c.accent.primary,
                fontSize: 11,
                fontWeight: 600,
              }}>
                {Math.round(yt.progress.percent)}%
              </span>
              {!isPaused && (
                <button
                  onClick={() => yt.pauseAnalysis(yt.progress!.analysisId)}
                  style={{
                    padding: '4px 14px',
                    background: '#fbbf24',
                    border: 'none',
                    color: '#000',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  PAUSE
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'analyze' && (
          <div>
            <VideoInput
              onAnalyze={yt.startAnalysis}
              onAddToQueue={yt.addToQueue}
              loading={yt.loading}
              skipCuts={skipCuts}
            />

            {yt.progress && (isAnalyzing || isPaused) && (
              <AnalysisProgress
                progress={yt.progress}
                onCancel={() => yt.cancelAnalysis(yt.progress!.analysisId)}
                onPause={() => yt.pauseAnalysis(yt.progress!.analysisId)}
                onResume={(options) => yt.resumeAnalysis(yt.progress!.analysisId, options)}
              />
            )}

            {/* Show current analysis detail */}
            {yt.currentAnalysis && (
              <div>
                <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h3 style={{ color: c.text.primary, fontSize: 14, fontWeight: 600, margin: '0 0 2px' }}>
                      {yt.currentAnalysis.title}
                    </h3>
                    <span style={{ color: c.text.secondary, fontSize: 11 }}>
                      {yt.currentAnalysis.channel} &middot; {yt.effects.length} effects detected
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={async () => {
                        try {
                          const md = await yt.exportAnalysis({ analysisId: yt.currentAnalysis!.id, format: 'markdown', includeFramePaths: false });
                          await navigator.clipboard.writeText(md);
                          setToast('Copied to clipboard');
                          setTimeout(() => setToast(null), 2000);
                        } catch {
                          setToast('Export failed');
                          setTimeout(() => setToast(null), 2000);
                        }
                      }}
                      style={{
                        padding: '5px 12px',
                        background: c.bg.tertiary,
                        color: c.text.primary,
                        border: `1px solid ${c.border.default}`,
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Export
                    </button>
                    <button
                      onClick={yt.closeAnalysis}
                      style={{
                        padding: '5px 12px',
                        background: c.bg.tertiary,
                        color: c.text.secondary,
                        border: `1px solid ${c.border.default}`,
                        borderRadius: 4,
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* Summary */}
                {yt.currentAnalysis.summary && (
                  <div style={{ padding: '0 20px 12px' }}>
                    <p style={{ color: c.text.secondary, fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                      {yt.currentAnalysis.summary}
                    </p>
                  </div>
                )}

                {/* Timeline */}
                <EffectTimeline
                  effects={yt.effects}
                  duration={yt.currentAnalysis.duration}
                  selectedId={selectedEffect?.id || null}
                  onSelect={setSelectedEffect}
                  activeCategories={activeCategories}
                  onToggleCategory={handleToggleCategory}
                  viewMode={viewMode}
                  onSetViewMode={setViewMode}
                />

                {/* Selected effect detail */}
                {selectedEffect && (
                  <div style={{ marginTop: 16 }}>
                    <EffectDetail
                      effect={selectedEffect}
                      onRate={yt.rateEffect}
                      onSavePreset={yt.saveAsPreset}
                      onPrev={handlePrev}
                      onNext={handleNext}
                      hasPrev={selectedIndex > 0}
                      hasNext={selectedIndex < filteredEffects.length - 1}
                      effectPosition={selectedIndex >= 0 ? `${selectedIndex + 1} / ${filteredEffects.length}` : undefined}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'queue' && (
          <BatchQueue
            queue={yt.queue}
            onRemove={yt.removeFromQueue}
            onProcess={yt.processQueue}
          />
        )}

        {tab === 'library' && (
          <div style={{ padding: 20 }}>
            <h3 style={{ color: c.text.primary, fontSize: 14, fontWeight: 600, margin: '0 0 16px' }}>
              Analysis Library ({yt.analyses.length})
            </h3>
            {yt.analyses.length === 0 ? (
              <div style={{ color: c.text.secondary, fontSize: 12, textAlign: 'center', padding: 40 }}>
                No analyses yet. Go to the Analyze tab to get started.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
                {yt.analyses.map(a => (
                  <AnalysisCard
                    key={a.id}
                    analysis={a}
                    onClick={() => { yt.openAnalysis(a.id); setTab('analyze'); }}
                    onDelete={() => yt.deleteAnalysis(a.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'training' && (
          <div style={{ padding: 20 }}>
            <h3 style={{ color: c.text.primary, fontSize: 14, fontWeight: 600, margin: '0 0 16px' }}>
              Training Stats
            </h3>
            {yt.trainingStats ? (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 500, marginBottom: 20 }}>
                  <StatCard label="Total Effects" value={yt.trainingStats.totalEffects} />
                  <StatCard label="Rated" value={yt.trainingStats.ratedEffects} />
                  <StatCard label="Avg Rating" value={yt.trainingStats.averageRating.toFixed(1)} color={yt.trainingStats.averageRating >= 3.5 ? c.status.success : yt.trainingStats.averageRating >= 2.5 ? c.status.warning : c.status.error} />
                  <StatCard label="Accurate (4-5)" value={yt.trainingStats.thumbsUp} color={c.status.success} />
                  <StatCard label="Inaccurate (1-2)" value={yt.trainingStats.thumbsDown} color={c.status.error} />
                  <StatCard label="Corrections" value={yt.trainingStats.corrections} />
                </div>

                {/* Rating distribution bar chart */}
                {yt.trainingStats.ratedEffects > 0 && (
                  <div style={{
                    background: c.bg.elevated,
                    borderRadius: 8,
                    border: `1px solid ${c.border.default}`,
                    padding: 16,
                    maxWidth: 500,
                  }}>
                    <div style={{ color: c.text.primary, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
                      Rating Distribution
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {yt.trainingStats.ratingDistribution.map((count, i) => {
                        const maxCount = Math.max(...yt.trainingStats!.ratingDistribution);
                        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ width: 12, fontSize: 12, color: c.text.secondary, textAlign: 'right', fontWeight: 600 }}>
                              {i + 1}
                            </span>
                            <div style={{ flex: 1, height: 20, background: c.bg.tertiary, borderRadius: 4, overflow: 'hidden' }}>
                              <div style={{
                                height: '100%',
                                width: `${pct}%`,
                                background: RATING_BAR_COLORS[i],
                                borderRadius: 4,
                                minWidth: count > 0 ? 4 : 0,
                                transition: 'width 0.3s',
                              }} />
                            </div>
                            <span style={{ width: 30, fontSize: 11, color: c.text.secondary, textAlign: 'right' }}>
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: c.text.secondary, fontSize: 12 }}>Loading stats...</div>
            )}
          </div>
        )}
      </div>

      {/* Toast overlay */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: c.bg.elevated,
          color: c.text.primary,
          padding: '8px 20px',
          borderRadius: 6,
          fontSize: 12,
          fontWeight: 600,
          border: `1px solid ${c.border.default}`,
          zIndex: 9999,
          pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }): React.ReactElement {
  return (
    <div style={{
      background: c.bg.elevated,
      borderRadius: 8,
      padding: 16,
      border: `1px solid ${c.border.default}`,
      textAlign: 'center',
    }}>
      <div style={{ color: color || c.text.primary, fontSize: 24, fontWeight: 700, marginBottom: 4 }}>
        {value}
      </div>
      <div style={{ color: c.text.secondary, fontSize: 11 }}>{label}</div>
    </div>
  );
}
