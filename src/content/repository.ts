import { join } from 'node:path';
import { loadApprovalQueue, updateFileQueue, loadHistory, type ApprovalItem } from './store.js';
import type { ContentFingerprint } from './weeklyPlan.js';

export interface ContentRepository {
  loadQueue(): Promise<ApprovalItem[]>;
  loadHistory(): Promise<ContentFingerprint[]>;
  updateQueue(change: (queue: ApprovalItem[]) => void): Promise<ApprovalItem[]>;
}

// Local CLI only. Replit uses the transactional PostgreSQL repository.
export class FileContentRepository implements ContentRepository {
  private readonly queuePath: string;
  constructor(private readonly root: string) { this.queuePath = join(root, 'social-agents', 'approval-queue.json'); }
  loadQueue() { return loadApprovalQueue(this.queuePath); }
  loadHistory() { return loadHistory(join(this.root, 'social-agents', 'content-history.json')); }
  async updateQueue(change: (queue: ApprovalItem[]) => void): Promise<ApprovalItem[]> {
    return updateFileQueue(this.queuePath, change);
  }
}
