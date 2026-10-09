import { brandConfig } from './brands.js';
import { deploymentConfig } from './config.js';
export function multiConfig(env: NodeJS.ProcessEnv = process.env) {
  const { brands, principals } = brandConfig(env);
  const config = deploymentConfig({ ...env, SOCIAL_OS_ADMIN_TOKEN: principals[0]!.token, SOCIAL_OS_WORKSPACE: brands[0]!.slug });
  const postizKey = env.POSTIZ_API_KEY ?? '';
  if (!postizKey.trim()) throw new Error('POSTIZ_API_KEY required');
  return { ...config, brands, principals, postizKey, postizUrl: env.POSTIZ_API_URL };
}
