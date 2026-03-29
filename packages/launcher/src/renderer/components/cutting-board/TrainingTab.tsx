import React, { useState, useEffect, useCallback } from 'react';
import { c } from '../../styles.js';
import { TrainingProgress } from './shared.js';
import { WorkoutQueuePanel } from './WorkoutQueuePanel.js';
import { PersonalRecordsPanel } from './PersonalRecordsPanel.js';
import { TrainingMonster } from './TrainingMonster.js';
import type { CuttingBoardTrainingRun, CuttingBoardTrainingDataSummary, CloudTrainingRun } from '@mayday/types';
import type { LocalTrainResult } from '../../hooks/useCuttingBoard.js';

const MIN_REPS = 30;

export function TrainingTab({ trainingDataSummary, trainingRuns, training, trainModel, postTrainResult, cloudRegistry, dismissPostTrain }: {
  trainingDataSummary: CuttingBoardTrainingDataSummary | null;
  trainingRuns: CuttingBoardTrainingRun[];
  training: boolean;
  trainModel: () => void;
  postTrainResult: LocalTrainResult | null;
  cloudRegistry: CloudTrainingRun[];
  dismissPostTrain: () => void;
}): React.ReactElement {
  const [monsterState, setMonsterState] = useState<'idle' | 'working-out' | 'celebrating'>('idle');
  const [workoutProgress, setWorkoutProgress] = useState(0);

  const totalReps = trainingDataSummary?.totalRecords ?? 0;
  const canTrain = totalReps >= MIN_REPS && !training && !postTrainResult;

  // Animate progress during training
  useEffect(() => {
    if (!training) {
      if (monsterState === 'working-out') {
        setMonsterState('celebrating');
        setWorkoutProgress(100);
        const timer = setTimeout(() => setMonsterState('idle'), 3000);
        return () => clearTimeout(timer);
      }
      return;
    }
    const interval = setInterval(() => {
      setWorkoutProgress(prev => Math.min(95, prev + (prev < 50 ? 4 : prev < 80 ? 2 : 0.5)));
    }, 200);
    return () => clearInterval(interval);
  }, [training, monsterState]);

  // Auto-dismiss postTrainResult after 5 seconds
  useEffect(() => {
    if (!postTrainResult) return;
    const timer = setTimeout(dismissPostTrain, 5000);
    return () => clearTimeout(timer);
  }, [postTrainResult, dismissPostTrain]);

  const handleStartWorkout = useCallback(() => {
    setMonsterState('working-out');
    setWorkoutProgress(0);
    trainModel();
  }, [trainModel]);

  // Speech bubble text
  const noData = totalReps === 0 && trainingRuns.length === 0;
  const speechText = monsterState === 'celebrating' && postTrainResult
    ? `New PR! v${postTrainResult.version} — ${Math.round(postTrainResult.accuracy * 100)}%`
    : monsterState === 'idle' && noData
    ? 'I need data to train! Edit in Premiere to give me reps.'
    : monsterState === 'idle' && totalReps < MIN_REPS
    ? `Need ${MIN_REPS - totalReps} more reps!`
    : monsterState === 'idle'
    ? "Let's hit the gym!"
    : undefined;
  const monsterMood = noData ? 'bored' as const : undefined;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left — Workout Queue */}
        <div style={{ flex: 1 }}>
          <WorkoutQueuePanel summary={trainingDataSummary} />
        </div>

        {/* Center — Monster + Train button */}
        <div style={{ flex: 1.2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          {/* Monster */}
          <TrainingMonster
            state={monsterState}
            progress={workoutProgress}
            speechText={speechText}
            mood={monsterMood}
          />

          {/* Training progress bar */}
          {training && (
            <div style={{ width: '100%', marginBottom: 12, marginTop: 8 }}>
              <TrainingProgress />
            </div>
          )}

          {/* Post-training success message */}
          {postTrainResult && (
            <div style={{
              width: '100%',
              background: '#1b433222',
              border: `1px solid ${c.status.success}44`,
              borderRadius: 6,
              padding: 12,
              marginBottom: 12,
            }}>
              <div style={{ fontSize: 12, color: c.text.primary, fontWeight: 600, marginBottom: 8, textAlign: 'center' }}>
                Workout complete! v{postTrainResult.version} — {(postTrainResult.accuracy * 100).toFixed(1)}% on {postTrainResult.trainingSize} reps
              </div>
              <div style={{ fontSize: 10, color: c.status.success, marginBottom: 8, textAlign: 'center' }}>
                Automatically synced to cloud registry.
              </div>
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={dismissPostTrain}
                  style={{
                    padding: '6px 16px',
                    background: c.accent.primary,
                    border: 'none',
                    borderRadius: 4,
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {/* Train button — hidden during post-train flow */}
          {!postTrainResult && (
            <button
              onClick={handleStartWorkout}
              disabled={!canTrain}
              style={{
                padding: '10px 28px',
                background: canTrain ? c.accent.primary : c.bg.tertiary,
                color: canTrain ? '#fff' : c.text.disabled,
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 700,
                cursor: canTrain ? 'pointer' : 'default',
                marginTop: 4,
              }}
            >
              {training ? 'Working out...' : 'Start Workout'}
            </button>
          )}
        </div>

        {/* Right — Personal Records */}
        <div style={{ flex: 1 }}>
          <PersonalRecordsPanel trainingRuns={trainingRuns} cloudRegistry={cloudRegistry} />
        </div>
      </div>
    </div>
  );
}
