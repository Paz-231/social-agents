export interface DeploymentConfig { databaseUrl: string; token: string; workspace: string; port: number; intervalMs: number }
export function deploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const databaseUrl = env.DATABASE_URL ?? '';
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new Error('Valid DATABASE_URL required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must be PostgreSQL');
  const token = env.SOCIAL_OS_ADMIN_TOKEN ?? '';
  if (token.length < 32 || token !== token.trim() || /\s/.test(token)) throw new Error('SOCIAL_OS_ADMIN_TOKEN must contain at least 32 characters without whitespace');
  const workspace = env.SOCIAL_OS_WORKSPACE ?? '';
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(workspace)) throw new Error('Explicit SOCIAL_OS_WORKSPACE slug required');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const intervalMs = Number(env.SOCIAL_OS_TICK_MS ?? 30_000);
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 60_000) throw new Error('SOCIAL_OS_TICK_MS must be 1000..60000');
  // Fail closed even if legacy credentials/config happen to exist in an imported app.
  if (env.SOCIAL_OS_ENABLE_PUBLISHING && env.SOCIAL_OS_ENABLE_PUBLISHING !== 'false') throw new Error('Publishing is unavailable in the review deployment');
  return { databaseUrl, token, workspace, port, intervalMs };
}
