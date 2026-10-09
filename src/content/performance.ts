export interface PerformanceSample {
  postId: string;
  pillar: string;
  format: string;
  reach?: number;
  views?: number;
  saves?: number;
  shares?: number;
  comments?: number;
  clicks?: number;
}

export interface PerformanceLearning {
  key: string;
  score: number;
  reason: string;
}

export function deriveLearnings(samples: PerformanceSample[]): PerformanceLearning[] {
  if (!samples.length) return [];
  const groups = new Map<string, PerformanceSample[]>();
  for (const sample of samples) {
    const key = `${sample.pillar}:${sample.format}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()].map(([key, rows]) => {
    const score = rows.reduce((sum, x) => sum + (x.saves ?? 0) * 3 + (x.shares ?? 0) * 4 + (x.comments ?? 0) * 2 + (x.clicks ?? 0) * 5 + (x.views ?? x.reach ?? 0) * 0.01, 0) / rows.length;
    return { key, score, reason: `Weighted average from ${rows.length} published post(s)` };
  }).sort((a, b) => b.score - a.score);
}
