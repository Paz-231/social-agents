import { join } from 'node:path';
import type { SocialPublishingProvider } from '../providers/types.js';
import { assertNovel, validateWeeklyMix, type PlannedPost } from './weeklyPlan.js';
import { loadApprovalQueue, loadHistory, saveApprovalQueue, saveHistory, type ApprovalItem } from './store.js';

export class WeeklyContentOrchestrator {
  constructor(private readonly workspaceRoot: string, private readonly provider: SocialPublishingProvider) {}

  private queuePath() { return join(this.workspaceRoot, 'social-agents', 'approval-queue.json'); }
  private historyPath() { return join(this.workspaceRoot, 'social-agents', 'content-history.json'); }

  async stageWeek(posts: PlannedPost[]): Promise<ApprovalItem[]> {
    validateWeeklyMix(posts);
    const history = await loadHistory(this.historyPath());
    const staged: ApprovalItem[] = [];
    for (const post of posts) {
      assertNovel(post, [...history, ...staged.map((x) => x.post)]);
      staged.push({ id: `week-${post.day}-${Date.now()}-${staged.length}`, post, status: 'pending' });
    }
    await saveApprovalQueue(this.queuePath(), staged);
    return staged;
  }

  async scheduleApproved(id: string, accountMap: Record<string, string>, scheduleAt: string, variants: Record<string, string>): Promise<ApprovalItem> {
    const queue = await loadApprovalQueue(this.queuePath());
    const item = queue.find((x) => x.id === id);
    if (!item) throw new Error('Approval item not found');
    if (item.status !== 'approved') throw new Error('Human approval required before scheduling');

    const platformVariants = item.post.platforms.map((platform) => {
      const accountId = accountMap[platform];
      if (!accountId) throw new Error(`No Postiz account mapping for ${platform}`);
      const content = variants[platform];
      if (!content) throw new Error(`No approved copy for ${platform}`);
      return { platform, accountId, content };
    });

    if (!Number.isFinite(Date.parse(scheduleAt)) || Date.parse(scheduleAt) <= Date.now()) throw new Error('Schedule must be a valid future timestamp');
    if (item.variants && JSON.stringify(item.variants) !== JSON.stringify(variants)) throw new Error('Approved content differs from submitted variants');
    const published = await this.provider.createPost({
      variants: platformVariants,
      scheduleAt,
      timezone: 'Europe/Vienna',
    });
    if (!published.id || published.status !== 'scheduled') throw new Error('Provider did not confirm scheduling');
    item.status = 'scheduled';
    item.scheduledAt = scheduleAt;
    item.providerPostId = published.id;
    item.variants = variants;
    await saveApprovalQueue(this.queuePath(), queue);

    // Scheduling is not publication. Update published history only after provider confirmation.
    return item;
  }
}
