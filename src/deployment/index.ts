import { deploymentConfig } from './config.js';
import { createPool, PostgresContentRepository } from './postgres.js';
import { reviewServer } from './server.js';

async function main(): Promise<void> {
  const config = deploymentConfig();
  const pool = createPool(config.databaseUrl);
  pool.on('error', () => console.error('Database connection failed'));
  const store = new PostgresContentRepository(pool, config.workspace);
  let busy: Promise<void> | undefined;
  let stopping = false;
  const tick = () => {
    if (busy || stopping) return;
    busy = store.tick().catch(() => console.error('Review scheduler tick failed')).finally(() => { busy = undefined; });
  };
  // Explicit migrate command runs before startup, never implicit destructive migrations.
  await store.tick();
  const timer = setInterval(tick, config.intervalMs);
  const server = reviewServer(store, config.token, () => stopping);
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const deadline = setTimeout(() => process.exit(1), 10_000);
    deadline.unref();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await busy;
    await pool.end();
    clearTimeout(deadline);
  };
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
  server.on('error', () => { console.error('Review HTTP server failed'); void shutdown(); process.exitCode = 1; });
  server.listen(config.port, '0.0.0.0', () => console.log(`Social OS review service listening on ${config.port}`));
}
void main().catch(() => { console.error('Review service startup failed; check configuration and migration'); process.exit(1); });
