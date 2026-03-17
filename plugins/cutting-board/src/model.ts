import brain from 'brain.js';
import { EDIT_TYPES } from './autocut-types.js';
import type { SerializedModel } from './autocut-types.js';
import type { TrainingExample } from './pipeline.js';
import fs from 'fs';
import path from 'path';

const MAX_DURATION = 60;
const MAX_GAP = 10;
const MAX_TRACK_INDEX = 10;
const MAX_TIME_SINCE_EDIT = 60_000; // ms

export function featureToVector(example: TrainingExample, recentEdits: TrainingExample[]): number[] {
  const ctx = example.context;

  const trackType = ctx.trackType === 'audio' ? 1 : 0;
  const trackIndex = Math.min(ctx.trackIndex / MAX_TRACK_INDEX, 1);
  const clipDuration = ctx.beforeDuration != null ? Math.min(ctx.beforeDuration / MAX_DURATION, 1) : 0.5;
  const clipPosition = Math.min(ctx.editPointTime / 600, 1);

  const playheadInClip = example.action.splitRatio ?? 0.5;
  const timeSinceLastEdit = recentEdits.length > 0
    ? Math.min((example.timestamp - recentEdits[recentEdits.length - 1].timestamp) / MAX_TIME_SINCE_EDIT, 1)
    : 1;

  const hasNeighborBefore = ctx.neighborBefore ? 1 : 0;
  const hasNeighborAfter = ctx.neighborAfter ? 1 : 0;
  const gapBefore = ctx.neighborBefore
    ? Math.min(Math.max(0, ctx.editPointTime - ctx.neighborBefore.end) / MAX_GAP, 1)
    : 0;
  const gapAfter = ctx.neighborAfter
    ? Math.min(Math.max(0, ctx.neighborAfter.start - ctx.editPointTime) / MAX_GAP, 1)
    : 0;

  const last10 = recentEdits.slice(-10);
  const total = Math.max(last10.length, 1);
  const recentCutFrac = last10.filter(e => e.editType === 'cut').length / total;
  const recentTrimHeadFrac = last10.filter(e => e.editType === 'trim-head').length / total;
  const recentTrimTailFrac = last10.filter(e => e.editType === 'trim-tail').length / total;
  const recentDeleteFrac = last10.filter(e => e.editType === 'delete').length / total;

  const ratedEdits = last10.filter(e => e.quality !== 'bad');
  const recentApprovalRate = last10.length > 0 ? ratedEdits.length / last10.length : 0.5;

  return [
    trackType, trackIndex, clipDuration, clipPosition,
    playheadInClip, timeSinceLastEdit,
    hasNeighborBefore, hasNeighborAfter, gapBefore, gapAfter,
    recentCutFrac, recentTrimHeadFrac, recentTrimTailFrac, recentDeleteFrac,
    recentApprovalRate,
  ];
}

export function editTypeToOutput(editType: string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const t of EDIT_TYPES) {
    output[t] = t === editType ? 1 : 0;
  }
  return output;
}

export function trainClassifier(examples: TrainingExample[]): { model: object; accuracy: number } {
  // Use string labels as keys — brain.js handles multi-class natively
  const trainingData: Array<{ input: number[]; output: Record<string, number> }> = [];

  for (let i = 0; i < examples.length; i++) {
    const ex = examples[i];
    if (ex.quality === 'bad') continue;

    const recentEdits = examples.slice(0, i);
    const input = featureToVector(ex, recentEdits);
    const output = editTypeToOutput(ex.editType);

    const copies = ex.quality === 'boosted' ? 3 : 1;
    for (let c = 0; c < copies; c++) {
      trainingData.push({ input, output });
    }
  }

  console.log(`[Model] Training on ${trainingData.length} samples`);

  const net = new brain.NeuralNetwork({
    hiddenLayers: [32, 16],
    activation: 'sigmoid',
  });

  const result = net.train(trainingData, {
    iterations: 20000,
    errorThresh: 0.005,
    log: false,
    logPeriod: 1000,
  });

  console.log(`[Model] Training complete: ${result.iterations} iterations, error: ${result.error.toFixed(6)}`);

  // Evaluate accuracy on training data
  let correct = 0;
  for (const item of trainingData) {
    const prediction = net.run(item.input) as Record<string, number>;
    const predicted = Object.entries(prediction).sort((a, b) => b[1] - a[1])[0][0];
    const actual = Object.entries(item.output).find(([, v]) => v === 1)?.[0] ?? 'unknown';
    if (predicted === actual) correct++;
  }
  const accuracy = trainingData.length > 0 ? correct / trainingData.length : 0;

  console.log(`[Model] Accuracy: ${(accuracy * 100).toFixed(1)}% (${correct}/${trainingData.length})`)

  return { model: net.toJSON(), accuracy };
}

export function trainRegressor(editType: string, examples: TrainingExample[]): object | null {
  const filtered = examples.filter(e => e.editType === editType && e.quality !== 'bad');
  if (filtered.length < 5) return null;

  const net = new brain.NeuralNetwork({
    hiddenLayers: [16, 8],
    activation: 'sigmoid',
  });

  const trainingData: Array<{ input: number[]; output: number[] }> = [];

  for (const ex of filtered) {
    const idx = examples.indexOf(ex);
    const recentEdits = examples.slice(0, idx);
    const input = featureToVector(ex, recentEdits);
    const output = getParameterOutput(ex);
    if (!output) continue;

    const copies = ex.quality === 'boosted' ? 3 : 1;
    for (let c = 0; c < copies; c++) {
      trainingData.push({ input, output });
    }
  }

  if (trainingData.length < 3) return null;

  net.train(trainingData, {
    iterations: 1000,
    errorThresh: 0.02,
    log: false,
  });

  return net.toJSON();
}

function getParameterOutput(example: TrainingExample): number[] | null {
  switch (example.editType) {
    case 'cut':
      return [example.action.splitRatio ?? 0.5];
    case 'trim-head':
    case 'trim-tail': {
      const amount = Math.abs(example.action.deltaDuration ?? 0);
      return [Math.min(amount / MAX_DURATION, 1)];
    }
    case 'delete':
      return [1];
    case 'move': {
      const offset = Math.abs(example.action.deltaStart ?? 0);
      return [Math.min(offset / MAX_DURATION, 1)];
    }
    case 'add':
      return [0.5];
    default:
      return null;
  }
}

export function instantiateNet(json: object): any {
  const net = new brain.NeuralNetwork();
  net.fromJSON(json as any);
  return net;
}

export function saveModel(model: SerializedModel, dataDir: string): void {
  const filePath = path.join(dataDir, 'autocut-model.json');
  fs.writeFileSync(filePath, JSON.stringify(model));
}

export function loadModel(dataDir: string): SerializedModel | null {
  const filePath = path.join(dataDir, 'autocut-model.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}
