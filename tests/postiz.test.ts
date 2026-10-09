import { describe, it, expect, vi } from 'vitest';
import { PostizProvider } from '../src/providers/postiz.js';
import type { PublishRequest } from '../src/providers/types.js';
const request: PublishRequest = { variants: [{ platform: 'facebook', accountId: 'fb1', content: 'Reviewed text', settings: { __type: 'facebook' } }], scheduleAt: '2030-01-01T12:00:00Z' };
describe('Postiz adapter contract', () => {
  it('blocks scheduling by default and immediate posting even with authorization', async () => {
    const transport = vi.fn();
    await expect(new PostizProvider({ apiKey: 'secret', fetchImpl: transport }).createPost(request)).rejects.toThrow(/authorization/);
    await expect(new PostizProvider({ apiKey: 'secret', allowScheduling: true, fetchImpl: transport }).createPost({ ...request, scheduleAt: undefined })).rejects.toThrow(/Immediate/);
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects past dates, multiple integrations and missing settings before any network call', async () => {
    const transport = vi.fn();
    const provider = new PostizProvider({ apiKey: 'secret', allowScheduling: true, fetchImpl: transport });
    await expect(provider.createPost({ ...request, scheduleAt: '2000-01-01' })).rejects.toThrow(/future/);
    await expect(provider.createPost({ ...request, variants: [...request.variants, ...request.variants] })).rejects.toThrow(/one integration/);
    await expect(provider.createPost({ ...request, variants: [{ ...request.variants[0]!, settings: {} }] })).rejects.toThrow(/settings/);
    expect(transport).not.toHaveBeenCalled();
  });
  it('uses documented create response and list endpoint with date range and state', async () => {
    const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify([{ postId: 'p1', integration: 'fb1' }])))
      .mockResolvedValueOnce(new Response(JSON.stringify({ posts: [{ id: 'p1', state: 'QUEUE' }] })));
    const provider = new PostizProvider({ apiKey: 'secret', allowScheduling: true, fetchImpl: transport });
    expect((await provider.createPost(request)).id).toBe('p1');
    expect((await provider.getPost('p1', request.scheduleAt)).status).toBe('QUEUE');
    const [url, opts] = transport.mock.calls[1]!;
    expect(url).toContain('/posts?startDate=');
    expect(url).toContain('endDate=');
    expect(opts.redirect).toBe('error');
    expect(JSON.parse(transport.mock.calls[0]![1].body).posts[0].settings.__type).toBe('facebook');
  });
  it('redacts error bodies and rejects unsafe transport URLs', async () => {
    const provider = new PostizProvider({ apiKey: 'secret', fetchImpl: vi.fn().mockResolvedValue(new Response('secret-token', { status: 401 })) });
    await expect(provider.listAccounts()).rejects.toThrow('Postiz request failed (401)');
    expect(() => new PostizProvider({ apiKey: 'secret', baseUrl: 'http://example.com' })).toThrow(/HTTPS/);
  });
});
