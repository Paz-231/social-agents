import { multiConfig } from './multiConfig.js';
import { createPool } from './postgres.js';
import { BrandStore } from './brandStore.js';
async function main() {
  const config = multiConfig(); const pool = createPool(config.databaseUrl);
  try {
    for (const brand of config.brands) await new BrandStore(pool,brand).migrate();
    console.log('Multi-brand schema initialized; no provider action');
  } finally { await pool.end(); }
}
void main().catch(() => { console.error('Brand migration failed; inspect configuration and existing channel bindings'); process.exitCode=1; });
