import { describe, it, expect, vi } from 'vitest';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { deploymentConfig } from '../src/deployment/config.js';
import { reviewServer, type ReviewStore } from '../src/deployment/server.js';
import { parsePilot } from '../src/deployment/manage.js';
const token = 'a'.repeat(48);
describe('review deployment', () => {
  it('fails closed on missing secrets or attempts to enable publishing', () => {
    expect(() => deploymentConfig({})).toThrow(/DATABASE_URL/);
    const env = { DATABASE_URL: 'postgresql://localhost/review', SOCIAL_OS_ADMIN_TOKEN: token, SOCIAL_OS_WORKSPACE: 'pasara-surf' };
    expect(deploymentConfig(env).port).toBe(3000);
    expect(() => deploymentConfig({ ...env, SOCIAL_OS_ENABLE_PUBLISHING: 'true' })).toThrow(/unavailable/);
    expect(() => deploymentConfig({ ...env, SOCIAL_OS_ADMIN_TOKEN: 'weak' })).toThrow(/32/);
    expect(() => deploymentConfig({ ...env, SOCIAL_OS_WORKSPACE: '../other' })).toThrow(/slug/);
  });
  it('serves minimal probes, protects data, rejects mutations and reports DB outages safely', async () => {
    const store: ReviewStore = { ready: vi.fn().mockResolvedValue(true), loadQueue: vi.fn().mockResolvedValue([]), status: vi.fn().mockResolvedValue({ pending: 7 }) };
    const server = reviewServer(store, token);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('port missing');
    const url = `http://127.0.0.1:${address.port}`;
    try {
      expect((await fetch(url + '/healthz')).status).toBe(200);
      expect((await fetch(url + '/readyz')).status).toBe(200);
      expect((await fetch(url + '/api/queue')).status).toBe(401);
      expect(store.loadQueue).not.toHaveBeenCalled();
      const headers = { Authorization: `Bearer ${token}` };
      expect(await (await fetch(url + '/api/queue', { headers })).json()).toEqual({ items: [] });
      expect((await fetch(url + '/api/approve', { headers, method: 'POST' })).status).toBe(405);
      vi.mocked(store.ready).mockRejectedValue(new Error('postgres://secret'));
      const response = await fetch(url + '/readyz');
      expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret');
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  });
  it('validates PASARA-SURF as seven unapproved drafts', async () => {
    const input = JSON.parse(await readFile(new URL('../templates/pasara-surf/pilot.json', import.meta.url), 'utf8'));
    const posts = parsePilot(input); expect(posts).toHaveLength(7);
    expect(posts.every((post) => post.requiresApproval)).toBe(true);
    input.posts[0].requiresApproval = false;
    expect(() => parsePilot(input)).toThrow();
  });
});
