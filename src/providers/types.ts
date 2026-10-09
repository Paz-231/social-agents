export type SocialPlatform = 'instagram' | 'tiktok' | 'facebook';

export interface PlatformVariant {
  platform: SocialPlatform;
  content: string;
  accountId: string;
  settings?: Record<string, unknown>;
}

export interface PublishRequest {
  variants: PlatformVariant[];
  media?: Array<{ url: string; path?: string }>;
  scheduleAt?: string;
  timezone?: string;
  draft?: boolean;
}

export interface PublishedPost {
  id: string;
  status: string;
  raw?: unknown;
}

export interface SocialPublishingProvider {
  readonly name: string;
  listAccounts(): Promise<Array<{ id: string; platform: string; name?: string }>>;
  createPost(request: PublishRequest): Promise<PublishedPost>;
  getPost(id: string, scheduleAt?: string): Promise<PublishedPost>;
}
