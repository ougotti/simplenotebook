import { test, expect } from '@playwright/test';
import { appPath } from './helpers/paths';

test.describe('Health Check Tests', () => {
  test('should connect to preview server', async ({ page }) => {
    try {
      // Simple page load test
      await page.goto(appPath('/'), { waitUntil: 'domcontentloaded' });

      // '/' redirects to /notes/new via router.replace() on mount. Reading the
      // title before that lands races the navigation and fails with
      // "Execution context was destroyed, most likely because of a navigation".
      await page.waitForURL(`**${appPath('/notes/new')}`);

      // Just check if page loads without errors
      const title = await page.title();
      expect(title).toBeTruthy();
      
      console.log('Page title:', title);
    } catch (error) {
      console.log('Health check failed:', error);
      throw error;
    }
  });
});