import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ContentFingerprint, PlannedPost } from './weeklyPlan.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'scheduled';

export interface ApprovalItem {
  id: string;
  post: PlannedPost;
  status: ApprovalStatus;
  scheduledAt?: string;
  providerPostId?: string;
  variants?: Record<string, string>;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export const loadHistory = (path: string) => readJson<ContentFingerprint[]>(path, []);
export const saveHistory = (path: string, value: ContentFingerprint[]) => writeJson(path, value);
export const loadApprovalQueue = (path: string) => readJson<ApprovalItem[]>(path, []);
export const saveApprovalQueue = (path: string, value: ApprovalItem[]) => writeJson(path, value);

export async function approve(queuePath: string, id: string): Promise<ApprovalItem> {
  const queue = await loadApprovalQueue(queuePath);
  const item = queue.find((x) => x.id === id);
  if (!item) throw new Error('Approval item not found');
  if (item.status !== 'pending') throw new Error('Only pending items can be approved');
  item.status = 'approved';
  await saveApprovalQueue(queuePath, queue);
  return item;
}
