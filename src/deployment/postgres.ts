import pg from 'pg';
import type { ContentRepository } from '../content/repository.js';
import type { ApprovalItem } from '../content/store.js';
import type { ContentFingerprint } from '../content/weeklyPlan.js';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS social_os_state (
  workspace text PRIMARY KEY,
  queue jsonb NOT NULL DEFAULT '[]'::jsonb,
  history jsonb NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS social_os_ticks (
  workspace text PRIMARY KEY,
  checked_at timestamptz NOT NULL,
  pending integer NOT NULL,
  approved integer NOT NULL,
  unresolved integer NOT NULL
);`;

export function createPool(connectionString: string): pg.Pool {
  // Keep TLS settings from DATABASE_URL; never disable certificate verification here.
  return new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000, statement_timeout: 5000, query_timeout: 6000 });
}

export class PostgresContentRepository implements ContentRepository {
  constructor(readonly pool: pg.Pool, readonly workspace: string) {}
  async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(173172, 1)');
      await client.query(SCHEMA);
      await client.query('INSERT INTO social_os_state(workspace) VALUES ($1) ON CONFLICT DO NOTHING', [this.workspace]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async loadQueue(): Promise<ApprovalItem[]> {
    const result = await this.pool.query('SELECT queue FROM social_os_state WHERE workspace=$1', [this.workspace]);
    if (!result.rows[0]) throw new Error('Workspace not initialized');
    return result.rows[0].queue as ApprovalItem[];
  }
  async loadHistory(): Promise<ContentFingerprint[]> {
    const result = await this.pool.query('SELECT history FROM social_os_state WHERE workspace=$1', [this.workspace]);
    if (!result.rows[0]) throw new Error('Workspace not initialized');
    return result.rows[0].history as ContentFingerprint[];
  }
  async updateQueue(change: (queue: ApprovalItem[]) => void): Promise<ApprovalItem[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query('SELECT queue FROM social_os_state WHERE workspace=$1 FOR UPDATE', [this.workspace]);
      if (!result.rows[0]) throw new Error('Workspace not initialized');
      const queue = result.rows[0].queue as ApprovalItem[];
      change(queue);
      await client.query('UPDATE social_os_state SET queue=$2::jsonb WHERE workspace=$1', [this.workspace, JSON.stringify(queue)]);
      await client.query('COMMIT');
      return queue;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async tick(): Promise<void> {
    // Cross-process row lock, snapshot and heartbeat commit together. No external actions.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await client.query('SELECT queue FROM social_os_state WHERE workspace=$1 FOR UPDATE', [this.workspace]);
      if (!state.rows[0]) throw new Error('Workspace not initialized');
      const queue = state.rows[0].queue as ApprovalItem[];
      const count = (status: string) => queue.filter((item) => item.status === status).length;
      await client.query(`INSERT INTO social_os_ticks VALUES ($1,now(),$2,$3,$4)
        ON CONFLICT (workspace) DO UPDATE SET checked_at=EXCLUDED.checked_at,
        pending=EXCLUDED.pending, approved=EXCLUDED.approved, unresolved=EXCLUDED.unresolved`,
      [this.workspace, count('pending'), count('approved'), count('submitting')]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async status(): Promise<unknown> {
    const result = await this.pool.query('SELECT checked_at,pending,approved,unresolved FROM social_os_ticks WHERE workspace=$1', [this.workspace]);
    return result.rows[0] ?? null;
  }
  async ready(maxAgeMs = 120_000): Promise<boolean> {
    const result = await this.pool.query('SELECT checked_at > now() - ($2 * interval \'1 millisecond\') AS fresh FROM social_os_ticks WHERE workspace=$1', [this.workspace, maxAgeMs]);
    return result.rows[0]?.fresh === true;
  }
}
