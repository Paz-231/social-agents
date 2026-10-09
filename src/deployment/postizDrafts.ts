import { draftSchema, type Brand } from './brands.js';
import type { DraftGateway } from './draftService.js';

export class PostizDraftGateway implements DraftGateway {
  private readonly baseUrl: string;
  constructor(private readonly key: string, baseUrl = 'https://api.postiz.com/public/v1', private readonly fetcher: typeof fetch = fetch) {
    const url = new URL(baseUrl);
    if (!key.trim() || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Valid server-side Postiz configuration required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }
  private async request(path: string, body?: unknown): Promise<any> {
    const response = await this.fetcher(this.baseUrl + path, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: { Authorization: this.key, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Postiz unavailable (${response.status})`);
    return response.json();
  }
  async verifyBinding(brand: Brand) {
    const rows = await this.request('/integrations');
    if (!Array.isArray(rows)) throw new Error('Invalid Postiz integrations');
    const matches = rows.filter(r => r.id === brand.integrationId);
    if (matches.length !== 1 || (matches[0].identifier ?? matches[0].providerIdentifier) !== brand.provider || matches[0].disabled === true) throw new Error('Postiz channel identity mismatch or disabled');
  }
  async createDraft(brand: Brand, input: unknown) {
    const payload = draftSchema.parse(input);
    const result = await this.request('/posts', {
      type: 'draft', date: new Date().toISOString(), shortLink: false, tags: [],
      posts: [{ integration: { id: brand.integrationId }, value: [{ content: payload.caption, image: payload.media }],
        settings: { __type: brand.provider, post_type: payload.postType } }],
    });
    const row = Array.isArray(result) && result.length === 1 ? result[0] : undefined;
    if (!row || typeof row.postId !== 'string' || !row.postId.trim() || row.integration !== brand.integrationId) throw new Error('Uncertain Postiz draft response; manual reconciliation required');
    return row.postId;
  }
  async verifyDraft(brand: Brand, id: string, at: string) {
    const day = 86_400_000;
    const query = new URLSearchParams({ startDate: new Date(Date.parse(at)-day).toISOString(), endDate: new Date(Date.parse(at)+day).toISOString() });
    const result = await this.request(`/posts?${query}`);
    const rows = Array.isArray(result.posts) ? result.posts.filter((r: any) => r.id === id) : [];
    if (rows.length !== 1 || rows[0].state !== 'DRAFT' || rows[0].integration?.id !== brand.integrationId || rows[0].integration?.providerIdentifier !== brand.provider) throw new Error('Provider draft state/channel not verified');
  }
  async analytics(brand: Brand) {
    const result = await this.request(`/analytics/${encodeURIComponent(brand.integrationId)}`);
    if (!Array.isArray(result)) throw new Error('Invalid provider analytics');
    return result;
  }
}
