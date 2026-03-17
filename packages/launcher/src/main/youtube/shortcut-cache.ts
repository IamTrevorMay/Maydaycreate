import brain from 'brain.js';
import fs from 'fs';
import path from 'path';
import type { EffectCategory } from '@mayday/types';

const EFFECT_CATEGORIES: Array<EffectCategory | 'no-effect'> = [
  'cut', 'transition', 'color-grade', 'text-overlay', 'blur', 'scale',
  'opacity', 'speed-ramp', 'mask', 'composite', 'audio-visual',
  'motion-graphics', 'stabilization', 'lens-effect', 'other', 'no-effect',
];

const CONFIDENCE_THRESHOLD = 0.85;
const SIMPLE_CATEGORIES: Set<string> = new Set(['cut']);
const MIN_TRAINING_EXAMPLES = 50;

export interface ShortcutPrediction {
  category: EffectCategory | 'no-effect';
  confidence: number;
  allScores: Record<string, number>;
}

export interface ShortcutModelStatus {
  ready: boolean;
  trained: boolean;
  accuracy: number;
  trainingExamples: number;
  modelPath: string;
}

function categoryToOutput(category: string): Record<string, number> {
  const output: Record<string, number> = {};
  for (const c of EFFECT_CATEGORIES) {
    output[c] = c === category ? 1 : 0;
  }
  return output;
}

export class ShortcutCache {
  private net: brain.NeuralNetwork<Record<string, number>, Record<string, number>> | null = null;
  private modelPath: string;
  private accuracy = 0;
  private trainingExamples = 0;

  constructor(dataDir: string) {
    this.modelPath = path.join(dataDir, 'shortcut-model.json');
    this.loadModel();
  }

  isReady(): boolean {
    return this.net !== null;
  }

  predict(features: number[]): ShortcutPrediction {
    if (!this.net) {
      return { category: 'no-effect', confidence: 0, allScores: {} };
    }

    const output = this.net.run(features) as Record<string, number>;
    const sorted = Object.entries(output).sort((a, b) => b[1] - a[1]);
    const topCategory = sorted[0][0] as EffectCategory | 'no-effect';
    const topConfidence = sorted[0][1];

    return {
      category: topCategory,
      confidence: topConfidence,
      allScores: output,
    };
  }

  shouldUseLocalPrediction(prediction: ShortcutPrediction): boolean {
    return prediction.confidence >= CONFIDENCE_THRESHOLD
      && SIMPLE_CATEGORIES.has(prediction.category);
  }

  train(data: Array<{ input: number[]; category: string }>): { accuracy: number; examples: number } {
    if (data.length < MIN_TRAINING_EXAMPLES) {
      console.log(`[ShortcutCache] Not enough training data (${data.length}/${MIN_TRAINING_EXAMPLES})`);
      return { accuracy: 0, examples: data.length };
    }

    const net = new brain.NeuralNetwork({
      hiddenLayers: [24, 12],
      activation: 'sigmoid' as const,
    });

    const trainingData = data.map(d => ({
      input: d.input,
      output: categoryToOutput(d.category),
    }));

    net.train(trainingData, {
      iterations: 2000,
      errorThresh: 0.01,
      log: false,
    });

    // Compute accuracy
    let correct = 0;
    for (const item of trainingData) {
      const prediction = net.run(item.input) as Record<string, number>;
      const predicted = Object.entries(prediction).sort((a, b) => b[1] - a[1])[0][0];
      const actual = Object.entries(item.output).find(([, v]) => v === 1)?.[0];
      if (predicted === actual) correct++;
    }
    const accuracy = trainingData.length > 0 ? correct / trainingData.length : 0;

    // Save model
    this.net = net as any;
    this.accuracy = accuracy;
    this.trainingExamples = data.length;
    this.saveModel();

    console.log(`[ShortcutCache] Trained on ${data.length} examples, accuracy: ${(accuracy * 100).toFixed(1)}%`);
    return { accuracy, examples: data.length };
  }

  getStatus(): ShortcutModelStatus {
    return {
      ready: this.isReady(),
      trained: this.net !== null,
      accuracy: this.accuracy,
      trainingExamples: this.trainingExamples,
      modelPath: this.modelPath,
    };
  }

  private saveModel(): void {
    if (!this.net) return;
    try {
      const serialized = {
        model: this.net.toJSON(),
        accuracy: this.accuracy,
        trainingExamples: this.trainingExamples,
        savedAt: new Date().toISOString(),
      };
      fs.mkdirSync(path.dirname(this.modelPath), { recursive: true });
      fs.writeFileSync(this.modelPath, JSON.stringify(serialized));
    } catch (err) {
      console.error('[ShortcutCache] Failed to save model:', err);
    }
  }

  private loadModel(): void {
    if (!fs.existsSync(this.modelPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.modelPath, 'utf-8'));
      const net = new brain.NeuralNetwork();
      net.fromJSON(data.model);
      this.net = net as any;
      this.accuracy = data.accuracy || 0;
      this.trainingExamples = data.trainingExamples || 0;
      console.log(`[ShortcutCache] Loaded model (${this.trainingExamples} examples, ${(this.accuracy * 100).toFixed(1)}% accuracy)`);
    } catch (err) {
      console.error('[ShortcutCache] Failed to load model:', err);
      this.net = null;
    }
  }
}
