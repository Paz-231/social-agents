import { multiConfig } from './multiConfig.js';
import { createPool } from './postgres.js';
import { BrandStore } from './brandStore.js';
import { DraftService } from './draftService.js';
import { PostizDraftGateway } from './postizDrafts.js';
import { brandServer } from './brandServer.js';

async function main(): Promise<void> {
  const config = multiConfig();
  const pool = createPool(config.databaseUrl);
  pool.on('error', () => console.error('Database connection failed'));
  const gateway = new PostizDraftGateway(config.postizKey,config.postizUrl);
  const services = config.brands.map(b => new DraftService(new BrandStore(pool,b),gateway));
  let busy: Promise<void> | undefined;
  let stopping = false;
  const runTick = async () => {
    for (const service of services) {
      try { await service.tick(); }
      catch { console.error(JSON.stringify({ event:'brand-monitor-failed',workspace:service.store.brand.slug })); }
    }
  };
  for (const service of services) await service.store.snapshot();
  await runTick();
  const tick = () => {
    if (busy || stopping) return;
    busy = runTick().catch(() => console.error('Monitor unavailable')).finally(() => { busy = undefined; });
  };
  const timer = setInterval(tick,config.intervalMs);
  const server = brandServer(services,config.principals,() => stopping);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1),10_000); deadline.unref();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await busy; await pool.end(); clearTimeout(deadline);
  };
  process.once('SIGTERM',() => void shutdown()); process.once('SIGINT',() => void shutdown());
  server.on('error',() => { console.error('HTTP server failed'); void shutdown(); process.exitCode=1; });
  server.listen(config.port,'0.0.0.0',() => console.log(`Social OS draft-only service listening on ${config.port}`));
}
void main().catch(() => { console.error('Startup failed; verify secrets, channel bindings and migrations'); process.exit(1); });
