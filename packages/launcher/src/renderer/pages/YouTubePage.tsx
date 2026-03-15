import React, { useState } from 'react';
import { c } from '../styles.js';
import { useYouTube } from '../hooks/useYouTube.js';
import { VideoInput } from '../components/youtube/VideoInput.js';
import { AnalysisProgress } from '../components/youtube/AnalysisProgress.js';
import { EffectTimeline } from '../components/youtube/EffectTimeline.js';
import { EffectDetail } from '../components/youtube/EffectDetail.js';
import { AnalysisCard } from '../components/youtube/AnalysisCard.js';
import { BatchQueue } from '../components/youtube/BatchQueue.js';
import type { DetectedEffect } from '@mayday/types';

type Tab = 'analyze' | 'queue' | 'library' | 'training';

const TABS: { id: Tab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'queue', label: 'Queue' },
  { id: 'library', label: 'Library' },
  { id: 'training', label: 'Training' },
];

export function YouTubePage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>('analyze');
  const [selectedEffect, setSelectedEffect] = useState<DetectedEffect | null>(null);
  const yt = useYouTube();

  const isAnalyzing = yt.progress && yt.progress.status !== 'complete' && yt.progress.status !== 'error' && yt.progress.status !== 'cancelled';

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

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'analyze' && (
          <div>
            <VideoInput
              onAnalyze={yt.startAnalysis}
              onAddToQueue={yt.addToQueue}
              loading={yt.loading}
            />

            {yt.progress && isAnalyzing && (
              <AnalysisProgress
                progress={yt.progress}
                onCancel={() => yt.cancelAnalysis(yt.progress!.analysisId)}
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
                      onClick={() => yt.exportAnalysis({ analysisId: yt.currentAnalysis!.id, format: 'markdown', includeFramePaths: false })}
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
                />

                {/* Selected effect detail */}
                {selectedEffect && (
                  <div style={{ marginTop: 16 }}>
                    <EffectDetail
                      effect={selectedEffect}
                      onRate={yt.rateEffect}
                      onSavePreset={yt.saveAsPreset}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, maxWidth: 500 }}>
                <StatCard label="Total Effects" value={yt.trainingStats.totalEffects} />
                <StatCard label="Rated" value={yt.trainingStats.ratedEffects} />
                <StatCard label="Accuracy" value={`${yt.trainingStats.accuracyPercent}%`} color={yt.trainingStats.accuracyPercent >= 70 ? c.status.success : c.status.warning} />
                <StatCard label="Thumbs Up" value={yt.trainingStats.thumbsUp} color={c.status.success} />
                <StatCard label="Thumbs Down" value={yt.trainingStats.thumbsDown} color={c.status.error} />
                <StatCard label="Corrections" value={yt.trainingStats.corrections} />
              </div>
            ) : (
              <div style={{ color: c.text.secondary, fontSize: 12 }}>Loading stats...</div>
            )}
          </div>
        )}
      </div>
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
