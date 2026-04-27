import React, { useState } from 'react';
import { c } from '../styles.js';
import { useCuttingBoard } from '../hooks/useCuttingBoard.js';
import { CutFinderTab } from '../components/cutting-board/CutFinderTab.js';
import { CutWatcherTab } from '../components/cutting-board/CutWatcherTab.js';
import { TrainingTab } from '../components/cutting-board/TrainingTab.js';

type Tab = 'cut-watcher' | 'cut-finder' | 'training';

const TABS: { id: Tab; label: string }[] = [
  { id: 'cut-watcher', label: 'Cut Watcher' },
  { id: 'cut-finder', label: 'Cut Finder' },
  { id: 'training', label: 'Training' },
];

export function CuttingBoardPage(): React.ReactElement {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('cuttingBoard:activeTab');
    return (saved === 'cut-watcher' || saved === 'cut-finder' || saved === 'training') ? saved : 'cut-watcher';
  });
  const changeTab = (t: Tab) => {
    setTab(t);
    localStorage.setItem('cuttingBoard:activeTab', t);
    if (t === 'training') cb.refresh();
  };
  const cb = useCuttingBoard();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
            onClick={() => changeTab(t.id)}
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
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'cut-watcher' && (
          <CutWatcherTab
            stats={cb.stats}
            sessions={cb.sessions}
            loaded={cb.loaded}
            deleteSession={cb.deleteSession}
            nameSession={cb.nameSession}
          />
        )}

        {tab === 'cut-finder' && <CutFinderTab />}

        {tab === 'training' && (
          <TrainingTab
            trainingDataSummary={cb.trainingDataSummary}
            trainingRuns={cb.trainingRuns}
            training={cb.training}
            trainModel={cb.trainModel}
            postTrainResult={cb.postTrainResult}
            cloudRegistry={cb.cloudRegistry}
            dismissPostTrain={cb.dismissPostTrain}
            trainError={cb.trainError}
            dismissTrainError={cb.dismissTrainError}
            machineId={cb.machineId}
          />
        )}
      </div>
    </div>
  );
}
