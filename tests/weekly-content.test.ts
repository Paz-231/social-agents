import { describe, expect, it } from 'vitest';
import { assertNovel, similarity, validateWeeklyMix, type PlannedPost } from '../src/content/weeklyPlan.js';
import { platformPrompt } from '../src/content/platformVariants.js';

const base = { topic: 'manual bookings', angle: 'time loss', hook: 'Still doing bookings by hand?', pillar: 'problem' as const, format: 'reel' as const, cta: 'Tell us' };

describe('weekly content loop', () => {
  it('blocks near duplicates', () => {
    expect(similarity(base, { ...base, hook: 'Bookings still by hand?' })).toBeGreaterThan(0.58);
    expect(() => assertNovel({ ...base, hook: 'Bookings still by hand?' }, [base])).toThrow(/Duplicate guard/);
  });

  it('requires a varied seven-post week with approval', () => {
    const posts = Array.from({ length: 7 }, (_, i) => ({
      ...base, day: i + 1, objective: 'awareness' as const, platforms: ['instagram'] as const, requiresApproval: true as const,
      pillar: (['problem','education','product','insight','social-proof','behind-scenes','founder'] as const)[i],
      format: i < 2 ? 'reel' as const : 'image' as const,
    })) as unknown as PlannedPost[];
    expect(() => validateWeeklyMix(posts)).not.toThrow();
  });

  it('creates platform-specific instructions', () => {
    const master = { topic: 'automation', hook: 'Stop paperwork', body: 'One workflow.', cta: 'How do you do it?' };
    expect(platformPrompt('instagram', master)).not.toEqual(platformPrompt('tiktok', master));
    expect(platformPrompt('facebook', master)).toContain('invite discussion');
  });
});
