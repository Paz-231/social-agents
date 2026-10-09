import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { ApprovalItem } from '../content/store.js';

export interface ReviewStore {
  loadQueue(): Promise<ApprovalItem[]>;
  status(): Promise<unknown>;
  ready(): Promise<boolean>;
}
export function reviewServer(store: ReviewStore, token: string, draining: () => boolean = () => false): Server {
  if (token.length < 32) throw new Error('Strong admin token required');
  return createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'Referrer-Policy': 'no-referrer' });
      res.end(JSON.stringify(body));
    };
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://review').pathname;
      if (req.method !== 'GET') return json(405, { error: 'read-only deployment' });
      if (path === '/healthz') return json(draining() ? 503 : 200, { status: draining() ? 'draining' : 'alive' });
      if (path === '/readyz') {
        const ready = !draining() && await store.ready();
        return json(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
      }
      const provided = Buffer.from(req.headers.authorization ?? '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json(401, { error: 'unauthorized' });
      if (path === '/api/queue') return json(200, { items: await store.loadQueue() });
      if (path === '/api/status') return json(200, { mode: 'review-only', publishing: false, scheduler: await store.status() });
      return json(404, { error: 'not found' });
    })().catch(() => json(503, { error: 'service unavailable' }));
  });
}
