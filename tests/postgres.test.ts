import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createPool, PostgresContentRepository } from '../src/deployment/postgres.js';
import type { ApprovalItem } from '../src/content/store.js';
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('PostgreSQL persistence integration', () => {
  it('survives pool restart, rolls back failures, isolates brands and serializes concurrent updates', async () => {
    const workspace = `test-${randomUUID()}`;
    let pool = createPool(url!);
    let store = new PostgresContentRepository(pool, workspace);
    try {
      await store.migrate();
      await Promise.all(Array.from({ length: 8 }, (_, i) => store.updateQueue((queue) => { queue.push({ id: String(i), status: 'pending', post: {} } as ApprovalItem); })));
      await expect(store.updateQueue((queue) => { queue.length = 0; throw new Error('abort'); })).rejects.toThrow('abort');
      await pool.end(); pool = createPool(url!); store = new PostgresContentRepository(pool, workspace);
      expect(await store.loadQueue()).toHaveLength(8);
      const other = new PostgresContentRepository(pool, workspace + '-other'); await other.migrate();
      expect(await other.loadQueue()).toEqual([]);
      expect(await store.ready()).toBe(false);
      await Promise.all([store.tick(), store.tick()]);
      expect(await store.ready()).toBe(true);
      expect(await store.status()).toMatchObject({ pending: 8, approved: 0, unresolved: 0 });
      await pool.query("UPDATE social_os_ticks SET checked_at=now()-interval '5 minutes' WHERE workspace=$1", [workspace]);
      expect(await store.ready()).toBe(false);
    } finally {
      await pool.query('DELETE FROM social_os_ticks WHERE workspace=$1', [workspace]);
      await pool.query('DELETE FROM social_os_state WHERE workspace = ANY($1::text[])', [[workspace, workspace + '-other']]);
      await pool.end();
    }
  });
});
