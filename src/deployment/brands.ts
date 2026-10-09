import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const brandSchema = z.object({
  slug: z.enum(['pasara-surf', 'runmycamp']),
  name: z.string().trim().min(1).max(80),
  integrationId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  provider: z.enum(['instagram', 'instagram-standalone']),
}).strict();
export type Brand = z.infer<typeof brandSchema>;
const principalSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  token: z.string().min(32).max(256).regex(/^\S+$/),
  workspaces: z.array(brandSchema.shape.slug).min(1),
}).strict();
export type Principal = z.infer<typeof principalSchema>;
export function brandConfig(env: NodeJS.ProcessEnv = process.env) {
  const brands = z.array(brandSchema).length(2).parse(JSON.parse(env.SOCIAL_OS_BRANDS ?? 'null'));
  if (new Set(brands.map(b => b.slug)).size !== 2 || new Set(brands.map(b => b.integrationId)).size !== 2 ||
    brands.some(b => b.provider !== (b.slug === 'pasara-surf' ? 'instagram' : 'instagram-standalone'))) {
    throw new Error('Unique, correctly typed brand/channel bindings required');
  }
  const principals = z.array(principalSchema).min(1).parse(JSON.parse(env.SOCIAL_OS_PRINCIPALS ?? 'null'));
  if (new Set(principals.map(p => p.id)).size !== principals.length || new Set(principals.map(p => p.token)).size !== principals.length) {
    throw new Error('Unique principals and tokens required');
  }
  return { brands, principals };
}
export function authenticate(header: string | undefined, principals: Principal[]): Principal | undefined {
  const digest = (s: string) => createHash('sha256').update(s).digest();
  const supplied = digest(header ?? '');
  return principals.find(p => timingSafeEqual(supplied, digest(`Bearer ${p.token}`)));
}
export class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const dnaSchema = z.object({
  audience: z.string().trim().min(1).max(4000), voice: z.string().trim().min(1).max(4000),
  offer: z.string().trim().min(1).max(4000), rules: z.array(z.string().trim().min(1).max(1000)).max(30),
  evidence: z.string().trim().min(1).max(4000),
}).strict();
export const draftSchema = z.object({
  caption: z.string().trim().min(1).max(2200),
  postType: z.enum(['post', 'story']),
  media: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/),
    path: z.url().refine(s => { const u = new URL(s); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; }),
  }).strict()).min(1).max(10),
}).strict();
export type DraftPayload = z.infer<typeof draftSchema>;
