import type { SocialPlatform } from '../providers/types.js';

export interface MasterPost {
  topic: string;
  hook: string;
  body: string;
  cta: string;
}

export function platformPrompt(platform: SocialPlatform, post: MasterPost): string {
  const rules: Record<SocialPlatform, string> = {
    instagram: 'Write for Instagram: strong first line, useful context, conversational CTA. Do not copy another platform verbatim.',
    tiktok: 'Write for TikTok: very short hook-first caption, native and direct. Avoid long explanatory copy.',
    facebook: 'Write for Facebook: add useful context and invite discussion. Natural prose, not an Instagram caption clone.',
  };
  return `${rules[platform]}\nTopic: ${post.topic}\nHook: ${post.hook}\nBody: ${post.body}\nCTA: ${post.cta}`;
}
