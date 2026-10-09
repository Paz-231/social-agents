import { createServer, type IncomingMessage } from 'node:http';
import { z, ZodError } from 'zod';
import { authenticate, RequestError, type Principal } from './brands.js';
import type { DraftService } from './draftService.js';
import { consoleHtml, consoleScript, consoleCss } from './console.js';

async function body(req: IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new RequestError(415,'JSON required');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length; if (size > 64 * 1024) throw new RequestError(413,'Request too large');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); }
  catch { throw new RequestError(400,'Invalid JSON'); }
}
const version = z.number().int().nonnegative();
export function brandServer(services: DraftService[], principals: Principal[], draining = () => false) {
  const server = createServer((req,res) => {
    const send = (status: number, data: unknown, html = false, script = false, css = false) => {
      res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : script ? 'text/javascript; charset=utf-8' : css ? 'text/css; charset=utf-8' : 'application/json',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy':'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'" });
      res.end(html || script || css ? data as string : JSON.stringify(data));
    };
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://local');
      const path = url.pathname;
      if (req.method === 'GET' && path === '/') return send(200,consoleHtml,true);
      if (req.method === 'GET' && path === '/console.css') return send(200,consoleCss,false,false,true);
      if (req.method === 'GET' && path === '/console.js') return send(200,consoleScript,false,true);
      if (req.method === 'GET' && path === '/healthz') return send(draining() ? 503 : 200,{ status: draining() ? 'draining' : 'alive' });
      if (req.method === 'GET' && path === '/readyz') {
        const ready = !draining() && (await Promise.all(services.map(s => s.store.ready()))).every(Boolean);
        return send(ready ? 200 : 503,{ status: ready ? 'ready' : 'unavailable' });
      }
      const principal = authenticate(req.headers.authorization,principals);
      if (!principal) throw new RequestError(401,'Unauthorized');
      if (draining()) throw new RequestError(503,'Service draining');
      if (url.search) throw new RequestError(400,'Query parameters unsupported');
      if (req.method === 'GET' && path === '/api/workspaces') return send(200,{ workspaces: services.filter(s => principal.workspaces.includes(s.store.brand.slug)).map(s => s.store.brand), mode:'draft-only' });
      const match = /^\/api\/workspaces\/([a-z0-9-]+)\/(snapshot|dna|assets|drafts)(?:\/([a-f0-9-]{36})\/(approve|reject|export-draft))?$/.exec(path);
      const service = match && services.find(s => s.store.brand.slug === match[1] && principal.workspaces.includes(s.store.brand.slug));
      if (!service || !match) throw new RequestError(404,'Not found');
      const store = service.store;
      if (req.method === 'GET' && match[2] === 'snapshot' && !match[3]) return send(200,await store.snapshot());
      if (req.method !== 'POST') throw new RequestError(405,'Method not allowed');
      if (req.headers['x-social-os-workspace'] !== store.brand.slug) throw new RequestError(409,'Explicit matching workspace required');
      // Bearer credentials remain in memory. No cookies, permissive CORS, global active brand, or query tokens.
      if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}` && req.headers.origin !== `http://${req.headers.host}`) throw new RequestError(403,'Cross-origin mutation blocked');
      const input = await body(req);
      if (match[2] === 'dna' && !match[3]) {
        const data = z.object({ dna:z.unknown(),version }).strict().parse(input);
        await store.setDna(data.dna,data.version,principal.id);
      } else if (match[2] === 'assets' && !match[3]) {
        const data = z.object({ asset:z.unknown(),evidence:z.string() }).strict().parse(input);
        await store.addAsset(data.asset as any,data.evidence,principal.id);
      } else if (match[2] === 'drafts' && !match[3]) {
        const data = z.object({ payload:z.unknown(),dnaVersion:version }).strict().parse(input);
        return send(201,await store.createDraft(data.payload,data.dnaVersion,principal.id));
      } else if (match[2] === 'drafts' && match[3] && match[4]) {
        z.uuid().parse(match[3]);
        const data = z.object({ revision:version }).strict().parse(input);
        if (match[4] === 'export-draft') await service.export(match[3],data.revision);
        else await store.decide(match[3],data.revision,match[4] === 'approve' ? 'approved' : 'rejected',principal.id);
      } else throw new RequestError(404,'Not found');
      return send(200,{ ok:true });
    })().catch(error => {
      if (error instanceof RequestError) return send(error.status,{ error:error.message });
      if (error instanceof ZodError) return send(400,{ error:'Invalid request fields' });
      if (error?.code === '23505') return send(409,{ error:'Duplicate content or media binding' });
      console.error('Social OS request failed');
      send(503,{ error:'Service unavailable; inspect monitor and reconcile uncertain drafts before retrying' });
    });
  });
  server.requestTimeout = 60_000; server.headersTimeout = 10_000;
  return server;
}
