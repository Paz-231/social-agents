import type { PublishRequest, PublishedPost, SocialPublishingProvider } from './types.js';

export interface PostizProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Must only be set after separate explicit scheduling authorization. */
  allowScheduling?: boolean;
}

export class PostizProvider implements SocialPublishingProvider {
  readonly name = 'postiz';
  private readonly allowScheduling: boolean;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PostizProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('POSTIZ_API_KEY is required');
    this.apiKey = options.apiKey;
    this.allowScheduling = options.allowScheduling === true;
    this.baseUrl = (options.baseUrl ?? process.env.POSTIZ_API_URL ?? 'https://api.postiz.com/public/v1').replace(/\/$/, '');
    const url = new URL(this.baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Postiz URL must use HTTPS without credentials, query or fragment');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'social-agents',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Postiz request failed (${response.status})`);
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; }
    catch { throw new Error('Postiz returned invalid JSON'); }
    return parsed as T;
  }

  async listAccounts(): Promise<Array<{ id: string; platform: string; name?: string }>> {
    const data = await this.request<unknown>('GET', '/integrations');
    const rows = Array.isArray(data) ? data : ((data as { integrations?: unknown[] })?.integrations ?? []);
    return rows.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        id: String(item.id ?? ''),
        platform: String(item.identifier ?? item.providerIdentifier ?? item.type ?? ''),
        name: typeof item.name === 'string' ? item.name : undefined,
      };
    });
  }

  async createPost(request: PublishRequest): Promise<PublishedPost> {
    if (!request.variants.length) throw new Error('At least one platform variant is required');
    if (!request.draft && !request.scheduleAt) {
      throw new Error('Safety block: PostizProvider requires draft=true or scheduleAt. Immediate autonomous publishing is disabled.');
    }

    if (!request.draft && !this.allowScheduling) throw new Error('Separate explicit scheduling authorization required');
    if (!request.draft && (!Number.isFinite(Date.parse(request.scheduleAt!)) || Date.parse(request.scheduleAt!) <= Date.now())) throw new Error('Schedule must be in the future');
    // One integration per call until every returned ID can be reconciled durably.
    if (request.variants.length !== 1) throw new Error('Postiz currently supports one integration per submission');
    for (const variant of request.variants) {
      if (!variant.accountId.trim() || !variant.content.trim()) throw new Error('Account and content required');
      if (!variant.settings?.__type) throw new Error('Explicit provider settings including __type required');
      if (variant.platform !== 'facebook' && !request.media?.length) throw new Error('Instagram and TikTok require uploaded media');
    }
    const body = {
      type: request.draft ? 'draft' : 'schedule',
      date: request.scheduleAt ?? new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts: request.variants.map((variant) => ({
        integration: { id: variant.accountId },
        value: [{
          content: variant.content,
          image: (request.media ?? []).map((m) => ({ id: m.url, path: m.path ?? m.url })),
        }],
        settings: variant.settings ?? {},
      })),
    };
    const raw = await this.request<unknown>('POST', '/posts', body);
    const item = Array.isArray(raw) ? raw[0] : raw;
    if (!item || typeof item !== 'object') throw new Error('Postiz did not return a post confirmation');
    const result = item as Record<string, unknown>;
    const id = result.id ?? result.postId;
    if (typeof id !== 'string' || !id.trim()) throw new Error('Postiz did not return a valid post ID');
    return { id, status: 'submitted', raw };
  }

  async getPost(id: string, scheduleAt?: string): Promise<PublishedPost> {
    if (!scheduleAt || !Number.isFinite(Date.parse(scheduleAt))) throw new Error('Postiz verification requires scheduled date');
    const day = 86_400_000;
    const query = new URLSearchParams({
      startDate: new Date(Date.parse(scheduleAt) - day).toISOString(),
      endDate: new Date(Date.parse(scheduleAt) + day).toISOString(),
    });
    const raw = await this.request<{ posts: Array<Record<string, unknown>> }>('GET', `/posts?${query}`);
    const post = raw.posts?.find((row) => row.id === id);
    if (!post) throw new Error('Postiz post not found in verification window');
    return { id, status: String(post.state ?? 'unknown'), raw: post };
  }
}
