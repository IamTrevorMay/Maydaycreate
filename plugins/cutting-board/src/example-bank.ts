import type { TrainingExample, EditContext } from './pipeline.js';
import { extractFeatures } from './pipeline.js';
import type { CutRecord } from './types.js';

export class ExampleBank {
  private examples: TrainingExample[] = [];

  load(records: Array<CutRecord & { quality: string; weight: number }>): void {
    this.examples = records.map(r => extractFeatures(r));
  }

  get size(): number {
    return this.examples.length;
  }

  getSimilar(query: EditContext, limit = 5): TrainingExample[] {
    if (this.examples.length === 0) return [];

    const scored = this.examples.map(ex => ({
      example: ex,
      score: this.similarityScore(query, ex) * ex.weight,
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .filter(s => s.score > 0)
      .map(s => s.example);
  }

  getBestExamples(limit = 10): TrainingExample[] {
    if (this.examples.length === 0) return [];

    // Balance across edit types, prioritize by weight
    const byType = new Map<string, TrainingExample[]>();
    for (const ex of this.examples) {
      if (!byType.has(ex.editType)) byType.set(ex.editType, []);
      byType.get(ex.editType)!.push(ex);
    }

    // Sort each type by weight descending
    for (const [, exs] of byType) {
      exs.sort((a, b) => b.weight - a.weight);
    }

    const result: TrainingExample[] = [];
    const types = [...byType.keys()];
    let round = 0;

    while (result.length < limit) {
      let added = false;
      for (const type of types) {
        const exs = byType.get(type)!;
        if (round < exs.length) {
          result.push(exs[round]);
          added = true;
          if (result.length >= limit) break;
        }
      }
      if (!added) break;
      round++;
    }

    return result;
  }

  getDistribution(): Record<string, { total: number; boosted: number; good: number; bad: number }> {
    const dist: Record<string, { total: number; boosted: number; good: number; bad: number }> = {};

    for (const ex of this.examples) {
      if (!dist[ex.editType]) {
        dist[ex.editType] = { total: 0, boosted: 0, good: 0, bad: 0 };
      }
      dist[ex.editType].total++;
      if (ex.quality === 'boosted') dist[ex.editType].boosted++;
      else if (ex.quality === 'good') dist[ex.editType].good++;
      else dist[ex.editType].bad++;
    }

    return dist;
  }

  private similarityScore(query: EditContext, example: TrainingExample): number {
    let score = 0;

    // Same edit type is a strong signal
    // (we don't know query edit type, so skip)

    // Same track type
    if (query.trackType === example.context.trackType) score += 1;

    // Same track index
    if (query.trackIndex === example.context.trackIndex) score += 0.5;

    // Temporal proximity (within 30s of each other)
    const timeDiff = Math.abs(query.editPointTime - example.context.editPointTime);
    if (timeDiff < 30) score += 1 - (timeDiff / 30);

    // Same media source
    if (query.mediaPath && query.mediaPath === example.context.mediaPath) score += 2;

    // Similar duration context
    if (query.beforeDuration != null && example.context.beforeDuration != null) {
      const durDiff = Math.abs(query.beforeDuration - example.context.beforeDuration);
      if (durDiff < 5) score += 1 - (durDiff / 5);
    }

    return score;
  }
}
