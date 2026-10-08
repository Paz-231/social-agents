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
  approvedPayload?: { variants: Record<string, string>; accountMap: Record<string, string>; scheduleAt: string };
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

export async function approve(queuePath: string, id: string, payload: { variants: Record<string, string>; accountMap: Record<string, string>; scheduleAt: string }): Promise<ApprovalItem> {
  const queue = await loadApprovalQueue(queuePath);
  const item = queue.find((x) => x.id === id);
  if (!item) throw new Error('Approval item not found');
  if (item.status !== 'pending') throw new Error('Only pending items can be approved');
  if (!Number.isFinite(Date.parse(payload.scheduleAt)) || Date.parse(payload.scheduleAt) <= Date.now()) throw new Error('Approval requires a future schedule');
  for (const platform of item.post.platforms) {
    if (!payload.variants[platform]?.trim() || !payload.accountMap[platform]?.trim()) throw new Error(`Missing approved copy or account for ${platform}`);
  }
  item.approvedPayload = structuredClone(payload);
  item.status = 'approved';
  await saveApprovalQueue(queuePath, queue);
  return item;
}
