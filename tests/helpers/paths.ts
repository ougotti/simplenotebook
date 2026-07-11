// next.config.js fixes basePath to '/simplenotebook'. baseURL in
// playwright.config.ts is the bare origin, so every navigation must include
// the basePath explicitly -- a leading '/' in page.goto() resolves against
// the origin and silently drops any path segment already in baseURL.
export const BASE_PATH = '/simplenotebook';

export function appPath(path: string = '/'): string {
  return `${BASE_PATH}${path === '/' ? '/' : path}`;
}
