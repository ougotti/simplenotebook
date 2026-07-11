// next.config.js sets basePath. baseURL in playwright.config.ts is the bare
// origin, so every navigation must include the basePath explicitly -- a
// leading '/' in page.goto() resolves against the origin and silently drops
// any path segment already in baseURL. Read basePath from next.config.js
// instead of duplicating the literal so the two can't drift apart.
import nextConfig from '../../next.config.js';

export const BASE_PATH: string = nextConfig.basePath ?? '';

export function appPath(path: string = '/'): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${BASE_PATH}${normalized}`;
}
