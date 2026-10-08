import type { PublishRequest, PublishedPost, SocialPublishingProvider } from './types.js';

export interface PostizProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class PostizProvider implements SocialPublishingProvider {
  readonly name = 'postiz';
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PostizProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('POSTIZ_API_KEY is required');
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? process.env.POSTIZ_API_URL ?? 'https://api.postiz.com/public/v1').replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(this.baseUrl + path, {
      method,
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'social-agents',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : undefined;
    if (!response.ok) throw new Error(`Postiz request failed (${response.status}): ${text.slice(0, 300)}`);
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

    const body = {
      type: request.draft ? 'draft' : 'schedule',
      date: request.scheduleAt,
      shortLink: false,
      tags: [],
      posts: request.variants.map((variant) => ({
        integration: { id: variant.accountId },
        value: [{
          content: variant.content,
          image: (request.media ?? []).map((m) => ({ id: m.url, path: m.url })),
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

  async getPost(id: string): Promise<PublishedPost> {
    const raw = await this.request<Record<string, unknown>>('GET', `/posts/${encodeURIComponent(id)}`);
    return { id, status: String(raw.status ?? 'unknown'), raw };
  }
}
