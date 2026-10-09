import type { SocialPlatform } from '../providers/types.js';

export type ContentPillar = 'problem' | 'education' | 'product' | 'insight' | 'social-proof' | 'behind-scenes' | 'founder';
export type ContentFormat = 'reel' | 'carousel' | 'image' | 'story';

export interface ContentFingerprint {
  topic: string;
  angle: string;
  hook: string;
  pillar: ContentPillar;
  format: ContentFormat;
  cta: string;
  publishedAt?: string;
}

export interface PlannedPost extends ContentFingerprint {
  day: number;
  objective: 'awareness' | 'engagement' | 'trust' | 'conversion' | 'saves';
  platforms: SocialPlatform[];
  requiresApproval: true;
}

export const DEFAULT_WEEK: Array<Omit<PlannedPost, 'topic' | 'angle' | 'hook' | 'cta'>> = [
  { day: 1, pillar: 'problem', format: 'reel', objective: 'awareness', platforms: ['instagram','tiktok','facebook'], requiresApproval: true },
  { day: 2, pillar: 'education', format: 'carousel', objective: 'saves', platforms: ['instagram','facebook'], requiresApproval: true },
  { day: 3, pillar: 'product', format: 'reel', objective: 'conversion', platforms: ['instagram','tiktok','facebook'], requiresApproval: true },
  { day: 4, pillar: 'insight', format: 'image', objective: 'trust', platforms: ['instagram','facebook'], requiresApproval: true },
  { day: 5, pillar: 'social-proof', format: 'reel', objective: 'trust', platforms: ['instagram','tiktok','facebook'], requiresApproval: true },
  { day: 6, pillar: 'behind-scenes', format: 'story', objective: 'engagement', platforms: ['instagram','facebook'], requiresApproval: true },
  { day: 7, pillar: 'founder', format: 'carousel', objective: 'engagement', platforms: ['instagram','facebook'], requiresApproval: true },
];

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9äöüß]+/gi, ' ').trim();

function tokens(value: string): Set<string> {
  return new Set(norm(value).split(/\s+/).filter((x) => x.length > 2));
}

export function similarity(a: ContentFingerprint, b: ContentFingerprint): number {
  const left = tokens(`${a.topic} ${a.angle} ${a.hook}`);
  const right = tokens(`${b.topic} ${b.angle} ${b.hook}`);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((x) => right.has(x)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

export function assertNovel(candidate: ContentFingerprint, history: ContentFingerprint[], threshold = 0.58): void {
  const duplicate = history.find((item) => similarity(candidate, item) >= threshold);
  if (duplicate) throw new Error(`Duplicate guard: content is too similar to previous topic "${duplicate.topic}"`);
}

export function validateWeeklyMix(posts: PlannedPost[]): void {
  if (posts.length !== 7) throw new Error('Weekly plan must contain exactly 7 posts');
  if (new Set(posts.map((p) => p.pillar)).size < 3) throw new Error('Weekly plan needs at least 3 content pillars');
  if (posts.filter((p) => p.format === 'reel').length < 2) throw new Error('Weekly plan needs at least 2 reels');
  if (posts.filter((p) => p.pillar === 'product').length > 2) throw new Error('Weekly plan allows at most 2 direct product posts');
  if (posts.some((p) => p.requiresApproval !== true)) throw new Error('MVP requires human approval for every post');
}
