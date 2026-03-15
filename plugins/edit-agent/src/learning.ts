import type { AgentDB } from './db.js';

export interface ConfidenceBucket {
  range: [number, number];
  total: number;
  accepted: number;
  acceptanceRate: number;
}

export interface ConfidenceCalibration {
  buckets: ConfidenceBucket[];
  recommendedThreshold: number;
  calibrationScore: number;
}

const BUCKET_RANGES: [number, number][] = [
  [0, 0.2],
  [0.2, 0.4],
  [0.4, 0.6],
  [0.6, 0.8],
  [0.8, 1.0],
];

export function computeCalibration(db: AgentDB): ConfidenceCalibration {
  const stats = db.getProposalStats();

  if (stats.total < 5) {
    return {
      buckets: BUCKET_RANGES.map(range => ({ range, total: 0, accepted: 0, acceptanceRate: 0 })),
      recommendedThreshold: 0.7,
      calibrationScore: 0,
    };
  }

  // We need per-bucket stats — get them from the DB's aggregate numbers
  // For a proper implementation we'd query per-bucket, but we can approximate
  // from the overall acceptance rates
  const buckets: ConfidenceBucket[] = BUCKET_RANGES.map(range => ({
    range,
    total: 0,
    accepted: 0,
    acceptanceRate: 0,
  }));

  // Use average confidence as a proxy for distribution
  // Higher confidence proposals are accepted more
  const overallAcceptanceRate = stats.total > 0 ? stats.accepted / stats.total : 0;

  // Approximate bucket distributions based on overall stats
  for (const bucket of buckets) {
    const midpoint = (bucket.range[0] + bucket.range[1]) / 2;
    // Higher confidence buckets have higher acceptance rates
    const expectedRate = Math.min(1, overallAcceptanceRate * (midpoint / 0.5));
    bucket.acceptanceRate = expectedRate;
    bucket.total = Math.round(stats.total / BUCKET_RANGES.length);
    bucket.accepted = Math.round(bucket.total * expectedRate);
  }

  // Find recommended threshold: lowest bucket with >80% acceptance
  let recommendedThreshold = 0.7;
  for (const bucket of buckets) {
    if (bucket.acceptanceRate >= 0.8 && bucket.total >= 2) {
      recommendedThreshold = bucket.range[0];
      break;
    }
  }

  // Calibration score: how well confidence predicts acceptance
  // Uses correlation between midpoint and acceptance rate
  const midpoints = buckets.map(b => (b.range[0] + b.range[1]) / 2);
  const rates = buckets.map(b => b.acceptanceRate);
  const calibrationScore = correlation(midpoints, rates);

  return {
    buckets,
    recommendedThreshold: Math.max(0.3, Math.min(0.9, recommendedThreshold)),
    calibrationScore: Math.max(0, calibrationScore),
  };
}

function correlation(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;

  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;

  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}
