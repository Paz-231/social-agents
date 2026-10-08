import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WeeklyContentOrchestrator } from '../src/content/orchestrator.js';
import type { SocialPublishingProvider } from '../src/providers/types.js';
import type { PlannedPost } from '../src/content/weeklyPlan.js';
import { approve } from '../src/content/store.js';
import { deriveLearnings } from '../src/content/performance.js';

const provider: SocialPublishingProvider = {
  name: 'fake',
  async listAccounts() { return []; },
  async createPost() { return { id: 'post_1', status: 'scheduled' }; },
  async getPost(id) { return { id, status: 'scheduled' }; },
};

function week(): PlannedPost[] {
  const pillars = ['problem','education','product','insight','social-proof','behind-scenes','founder'] as const;
  const topics = ['paperwork backlog','volume calculation','checkout automation','regional regulations','guest interviews','beach workshop','founder journey'];
  const angles = ['reduce admin','match equipment','avoid errors','explain obligations','show evidence','teach repair','explain mission'];
  return pillars.map((pillar, i) => ({
    day: i + 1, pillar, format: i < 2 ? 'reel' : 'image', objective: 'awareness',
    platforms: ['instagram'], requiresApproval: true, topic: topics[i]!,
    angle: angles[i]!, hook: topics[i]!, cta: `Learn about ${pillar}`,
  }));
}

describe('orchestrator', () => {
  it('stages pending posts and blocks scheduling before approval', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-agents-'));
    const o = new WeeklyContentOrchestrator(root, provider);
    const items = await o.stageWeek(week());
    expect(items.every((x) => x.status === 'pending')).toBe(true);
    await expect(o.scheduleApproved(items[0]!.id, { instagram: 'ig1' }, '2030-01-01T10:00:00Z', { instagram: 'copy' })).rejects.toThrow(/approval/i);
  });

  it('schedules only an approved item', async () => {
    const root = await mkdtemp(join(tmpdir(), 'social-agents-'));
    const o = new WeeklyContentOrchestrator(root, provider);
    const items = await o.stageWeek(week());
    const path = join(root, 'social-agents', 'approval-queue.json');
    await approve(path, items[0]!.id, { accountMap: { instagram: 'ig1' }, scheduleAt: '2030-01-01T10:00:00Z', variants: { instagram: 'copy' } });
    const result = await o.scheduleApproved(items[0]!.id, { instagram: 'ig1' }, '2030-01-01T10:00:00Z', { instagram: 'copy' });
    expect(result.status).toBe('scheduled');
  });

  it('derives performance learnings', () => {
    const rows = deriveLearnings([{ postId:'1', pillar:'education', format:'carousel', saves:10, shares:3 }]);
    expect(rows[0]!.key).toBe('education:carousel');
    expect(rows[0]!.score).toBeGreaterThan(0);
  });
});
