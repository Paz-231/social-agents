import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { brandSchema, dnaSchema, draftSchema, RequestError, type Brand, type DraftPayload } from './brands.js';

export const BRAND_SCHEMA = `
CREATE TABLE IF NOT EXISTS social_os_brands (
  workspace text PRIMARY KEY, binding jsonb NOT NULL, dna jsonb, dna_version integer NOT NULL DEFAULT 0,
  checked_at timestamptz, analytics jsonb, analytics_at timestamptz, provider_ok boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS social_os_assets (
  workspace text NOT NULL REFERENCES social_os_brands(workspace), id text NOT NULL UNIQUE,
  path text NOT NULL, evidence text NOT NULL, PRIMARY KEY(workspace,id)
);
CREATE TABLE IF NOT EXISTS social_os_drafts (
  workspace text NOT NULL REFERENCES social_os_brands(workspace), id uuid NOT NULL, revision integer NOT NULL DEFAULT 1,
  dna_version integer NOT NULL, payload jsonb NOT NULL, fingerprint text NOT NULL,
  status text NOT NULL CHECK(status IN ('pending','approved','rejected','exporting','exported')),
  approved_by text, provider_id text, export_started_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace,id), UNIQUE(workspace,fingerprint)
);
CREATE TABLE IF NOT EXISTS social_os_events (
  seq bigserial PRIMARY KEY, workspace text NOT NULL REFERENCES social_os_brands(workspace),
  draft_id uuid, actor text NOT NULL, action text NOT NULL, detail jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now()
);`;
export class BrandStore {
  constructor(readonly pool: pg.Pool, readonly brand: Brand) { brandSchema.parse(brand); }
  private async transaction<T>(fn: (client: pg.PoolClient, state: Record<string, any>) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const state = await c.query('SELECT * FROM social_os_brands WHERE workspace=$1 FOR UPDATE', [this.brand.slug]);
      if (!state.rows[0] || Object.keys(this.brand).some(k => state.rows[0].binding[k] !== this.brand[k as keyof Brand])) throw new Error('Brand binding mismatch; operator migration required');
      const result = await fn(c, state.rows[0]);
      await c.query('COMMIT'); return result;
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
  }
  async migrate(): Promise<void> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT pg_advisory_xact_lock(173172,2)');
      await c.query(BRAND_SCHEMA);
      await c.query('INSERT INTO social_os_brands(workspace,binding) VALUES($1,$2) ON CONFLICT DO NOTHING', [this.brand.slug, this.brand]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    await this.transaction(async () => {});
  }
  private async event(c: pg.PoolClient, actor: string, action: string, detail: unknown, id?: string) {
    await c.query('INSERT INTO social_os_events(workspace,draft_id,actor,action,detail) VALUES($1,$2,$3,$4,$5)', [this.brand.slug,id ?? null,actor,action,detail]);
  }
  async snapshot() {
    return this.transaction(async (c, state) => ({
      brand: this.brand, dna: state.dna, dnaVersion: state.dna_version,
      drafts: (await c.query('SELECT * FROM social_os_drafts WHERE workspace=$1 ORDER BY created_at DESC LIMIT 100', [this.brand.slug])).rows,
      history: (await c.query('SELECT * FROM social_os_events WHERE workspace=$1 ORDER BY seq DESC LIMIT 100', [this.brand.slug])).rows,
      assets: (await c.query('SELECT id,path,evidence FROM social_os_assets WHERE workspace=$1', [this.brand.slug])).rows,
      analytics: state.analytics, analyticsAt: state.analytics_at, providerOk: state.provider_ok, checkedAt: state.checked_at,
    }));
  }
  async setDna(input: unknown, version: number, actor: string) {
    const dna = dnaSchema.parse(input);
    return this.transaction(async (c, state) => {
      if (state.dna_version !== version) throw new RequestError(409, 'Brand DNA changed; reload');
      await c.query('UPDATE social_os_brands SET dna=$2,dna_version=dna_version+1 WHERE workspace=$1', [this.brand.slug,dna]);
      await c.query("UPDATE social_os_drafts SET status='pending',approved_by=NULL,revision=revision+1 WHERE workspace=$1 AND status='approved'", [this.brand.slug]);
      await this.event(c, actor, 'dna-updated', { dna, version: version + 1 });
    });
  }
  async addAsset(input: DraftPayload['media'][number], evidence: string, actor: string) {
    const asset = draftSchema.shape.media.element.parse(input);
    if (!evidence.trim() || evidence.length > 4000) throw new RequestError(400, 'Media rights/source evidence required');
    return this.transaction(async c => {
      await c.query('INSERT INTO social_os_assets(workspace,id,path,evidence) VALUES($1,$2,$3,$4)', [this.brand.slug,asset.id,asset.path,evidence]);
      await this.event(c, actor, 'asset-registered', asset);
    });
  }
  async createDraft(input: unknown, dnaVersion: number, actor: string) {
    const payload = draftSchema.parse(input);
    return this.transaction(async (c, state) => {
      if (!state.dna || state.dna_version !== dnaVersion) throw new RequestError(409, 'Current Brand DNA required');
      const assets = (await c.query('SELECT id,path FROM social_os_assets WHERE workspace=$1', [this.brand.slug])).rows;
      if (payload.media.some(m => !assets.some(a => a.id === m.id && a.path === m.path))) throw new RequestError(400, 'Media must belong to this workspace');
      const id = randomUUID();
      const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      await c.query("INSERT INTO social_os_drafts(workspace,id,dna_version,payload,fingerprint,status) VALUES($1,$2,$3,$4,$5,'pending')", [this.brand.slug,id,dnaVersion,payload,fingerprint]);
      await this.event(c, actor, 'draft-created', { payload, dnaVersion, binding: this.brand }, id);
      return { id, revision: 1 };
    });
  }
  async decide(id: string, revision: number, decision: 'approved' | 'rejected', actor: string) {
    return this.transaction(async (c,state) => {
      const row = (await c.query('SELECT * FROM social_os_drafts WHERE workspace=$1 AND id=$2', [this.brand.slug,id])).rows[0];
      if (!row) throw new RequestError(404,'Draft not found');
      if (row.revision !== revision || row.status !== 'pending' || row.dna_version !== state.dna_version) throw new RequestError(409,'Draft or DNA changed; create a current draft');
      await c.query('UPDATE social_os_drafts SET status=$3,approved_by=$4,revision=revision+1 WHERE workspace=$1 AND id=$2', [this.brand.slug,id,decision,actor]);
      await this.event(c,actor,decision,{ revision, payload: row.payload, dnaVersion: row.dna_version, binding: this.brand },id);
    });
  }
  async claimExport(id: string, revision: number): Promise<DraftPayload> {
    return this.transaction(async(c,state) => {
      const row = (await c.query('SELECT * FROM social_os_drafts WHERE workspace=$1 AND id=$2', [this.brand.slug,id])).rows[0];
      if (!row) throw new RequestError(404,'Draft not found');
      if (row.status !== 'approved' || row.revision !== revision || row.dna_version !== state.dna_version) throw new RequestError(409,'Current exact draft approval required');
      await c.query("UPDATE social_os_drafts SET status='exporting',export_started_at=now(),revision=revision+1 WHERE workspace=$1 AND id=$2",[this.brand.slug,id]);
      await this.event(c,'worker','draft-export-claimed',{ revision },id);
      return draftSchema.parse(row.payload);
    });
  }
  async recordExportId(id: string, providerId: string) {
    await this.transaction(async c => {
      const r = await c.query("UPDATE social_os_drafts SET provider_id=$3 WHERE workspace=$1 AND id=$2 AND status='exporting' AND provider_id IS NULL RETURNING id", [this.brand.slug,id,providerId]);
      if (!r.rowCount) throw new RequestError(409,'Export claim changed');
    });
  }
  async confirmExport(id: string) {
    await this.transaction(async c => {
      const r = await c.query("UPDATE social_os_drafts SET status='exported',revision=revision+1 WHERE workspace=$1 AND id=$2 AND status='exporting' AND provider_id IS NOT NULL RETURNING provider_id", [this.brand.slug,id]);
      if (r.rowCount) await this.event(c,'worker','provider-draft-verified',{ providerId: r.rows[0].provider_id },id);
    });
  }
  async pendingReconciliation() {
    return (await this.pool.query("SELECT id,provider_id,export_started_at FROM social_os_drafts WHERE workspace=$1 AND status='exporting' AND provider_id IS NOT NULL",[this.brand.slug])).rows;
  }
  async heartbeat(ok: boolean, analytics?: unknown) {
    await this.transaction(async c => {
      await c.query('UPDATE social_os_brands SET checked_at=now(),provider_ok=$2 WHERE workspace=$1', [this.brand.slug,ok]);
      if (analytics !== undefined) await c.query('UPDATE social_os_brands SET analytics=$2,analytics_at=now() WHERE workspace=$1',[this.brand.slug,JSON.stringify(analytics)]);
    });
  }
  async ready() {
    const r = await this.pool.query("SELECT provider_ok AND checked_at > now()-interval '120 seconds' AS ready FROM social_os_brands WHERE workspace=$1",[this.brand.slug]);
    return r.rows[0]?.ready === true;
  }
}
