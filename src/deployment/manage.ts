import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { deploymentConfig } from './config.js';
import { createPool, PostgresContentRepository } from './postgres.js';
import { assertNovel, validateWeeklyMix, type PlannedPost } from '../content/weeklyPlan.js';
import { z } from 'zod';

const postSchema = z.object({
  day: z.number().int().min(1).max(7),
  topic: z.string().trim().min(1), angle: z.string().trim().min(1), hook: z.string().trim().min(1), cta: z.string().trim().min(1),
  pillar: z.enum(['problem','education','product','insight','social-proof','behind-scenes','founder']),
  format: z.enum(['reel','carousel','image','story']), objective: z.enum(['awareness','engagement','trust','conversion','saves']),
  platforms: z.array(z.enum(['instagram','tiktok','facebook'])).min(1), requiresApproval: z.literal(true),
}).strict();
export function parsePilot(input: unknown): PlannedPost[] {
  const pilot = z.object({ workspace: z.literal('pasara-surf'), status: z.literal('unverified-draft'), posts: z.array(postSchema).length(7) }).strict().parse(input);
  validateWeeklyMix(pilot.posts);
  if (new Set(pilot.posts.map((post) => post.day)).size !== 7) throw new Error('Unique pilot days required');
  return pilot.posts;
}
async function main(): Promise<void> {
  const config = deploymentConfig();
  const pool = createPool(config.databaseUrl);
  const store = new PostgresContentRepository(pool, config.workspace);
  try {
    if (process.argv[2] === 'migrate') { await store.migrate(); console.log('Schema initialized'); return; }
    if (process.argv[2] === 'stage-pilot') {
      if (config.workspace !== 'pasara-surf') throw new Error('Pilot workspace mismatch');
      const posts = parsePilot(JSON.parse(await readFile(new URL('../../templates/pasara-surf/pilot.json', import.meta.url), 'utf8')));
      const history = await store.loadHistory();
      await store.updateQueue((queue) => {
        const candidates = [...history, ...queue.map((entry) => entry.post)];
        for (const post of posts) { assertNovel(post, candidates); candidates.push(post); }
        queue.push(...posts.map((post) => ({ id: randomUUID(), post, status: 'pending' as const })));
      });
      console.log('Seven pilot drafts staged locally in database; no provider call'); return;
    }
    throw new Error('Expected migrate or stage-pilot');
  } finally { await pool.end(); }
}
if (process.argv[1]?.endsWith('/deployment/manage.ts')) void main().catch(() => { console.error('Management command failed; verify configuration, workspace and input'); process.exitCode = 1; });
