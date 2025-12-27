import { test, expect } from '@playwright/test';

test.describe('Health Check Tests', () => {
  test('should connect to preview server', async ({ page }) => {
    try {
      // Simple page load test
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      
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