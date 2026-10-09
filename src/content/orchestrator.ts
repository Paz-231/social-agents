import type { SocialPublishingProvider } from '../providers/types.js';
import { assertNovel, validateWeeklyMix, type PlannedPost } from './weeklyPlan.js';
import type { ApprovalItem } from './store.js';
import { FileContentRepository, type ContentRepository } from './repository.js';
import { randomUUID } from 'node:crypto';

export class WeeklyContentOrchestrator {
  private readonly repository: ContentRepository;
  constructor(workspaceRoot: string, private readonly provider: SocialPublishingProvider, repository?: ContentRepository) {
    this.repository = repository ?? new FileContentRepository(workspaceRoot);
  }

  async stageWeek(posts: PlannedPost[]): Promise<ApprovalItem[]> {
    validateWeeklyMix(posts);
    const history = await this.repository.loadHistory();
    const staged: ApprovalItem[] = [];
    for (const post of posts) {
      assertNovel(post, [...history, ...staged.map((x) => x.post)]);
      staged.push({ id: randomUUID(), post, status: 'pending' });
    }
    await this.repository.updateQueue((queue) => {
      for (const item of staged) assertNovel(item.post, queue.map((entry) => entry.post));
      queue.push(...staged);
    });
    return staged;
  }

  async scheduleApproved(id: string, accountMap: Record<string, string>, scheduleAt: string, variants: Record<string, string>): Promise<ApprovalItem> {
    const queue = await this.repository.loadQueue();
    const item = queue.find((x) => x.id === id);
    if (!item) throw new Error('Approval item not found');
    if (item.status !== 'approved') throw new Error('Human approval required before scheduling');

    const approved = item.approvedPayload;
    if (!approved || approved.scheduleAt !== scheduleAt ||
      Object.keys(approved.variants).sort().join('|') !== Object.keys(variants).sort().join('|') ||
      Object.keys(approved.accountMap).sort().join('|') !== Object.keys(accountMap).sort().join('|') ||
      Object.keys(variants).some((key) => approved.variants[key] !== variants[key]) ||
      Object.keys(accountMap).some((key) => approved.accountMap[key] !== accountMap[key])) {
      throw new Error('Exact content, account mapping and time require approval');
    }
    const platformVariants = item.post.platforms.map((platform) => {
      const accountId = accountMap[platform];
      if (!accountId) throw new Error(`No Postiz account mapping for ${platform}`);
      const content = variants[platform];
      if (!content) throw new Error(`No approved copy for ${platform}`);
      return { platform, accountId, content, settings: { __type: platform } };
    });

    if (!Number.isFinite(Date.parse(scheduleAt)) || Date.parse(scheduleAt) <= Date.now()) throw new Error('Schedule must be a valid future timestamp');
    if (item.variants && JSON.stringify(item.variants) !== JSON.stringify(variants)) throw new Error('Approved content differs from submitted variants');
    await this.repository.updateQueue((latest) => {
      const current = latest.find((entry) => entry.id === id);
      if (!current || current.status !== 'approved' || JSON.stringify(current.approvedPayload) !== JSON.stringify(approved)) throw new Error('Approval changed or submission already claimed');
      current.status = 'submitting';
    });
    // An uncertain network outcome stays submitting. Never automatically retry POST.
    const published = await this.provider.createPost({
      variants: platformVariants,
      scheduleAt,
      timezone: 'Europe/Vienna',
    });
    if (!published.id) throw new Error('Provider did not return a post ID');
    await this.repository.updateQueue((latest) => {
      latest.find((entry) => entry.id === id)!.providerPostId = published.id;
    });
    const confirmed = await this.provider.getPost(published.id, scheduleAt);
    if (confirmed.status.toLowerCase() !== 'scheduled' && confirmed.status.toLowerCase() !== 'queue') throw new Error('Provider did not verify scheduled state');
    item.status = 'scheduled';
    item.scheduledAt = scheduleAt;
    item.providerPostId = published.id;
    item.variants = variants;
    await this.repository.updateQueue((latest) => {
      Object.assign(latest.find((entry) => entry.id === id)!, item);
    });

    // Scheduling is not publication. Update published history only after provider confirmation.
    return item;
  }
}
