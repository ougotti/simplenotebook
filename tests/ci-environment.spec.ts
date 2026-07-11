import { test, expect } from '@playwright/test';
import { appPath } from './helpers/paths';
import { seedUserSettings } from './helpers/seedUserSettings';

test.describe('Simplenotebook - CI Environment', () => {
  test.beforeEach(async ({ page }) => {
    page.setDefaultTimeout(15000);
    await seedUserSettings(page);
  });

  test('アプリケーションが正常に読み込まれる', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });

    // Wait for React app to hydrate
    await page.waitForSelector('h1', { timeout: 15000 });

    // Check for main elements
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('基本的なUI要素が表示される', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });

    // Wait for the form to be rendered
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });

    // Check for form elements
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toBeVisible();

    // Check for basic buttons
    await expect(page.locator('button').filter({ hasText: 'サインアウト' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: '設定' })).toBeVisible();
  });

  test('日本語文字が正しく表示される', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });

    // Wait for form to be ready
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });

    const japaneseTitle = '日本語テストCI環境🎌';
    const japaneseContent = '# 日本語見出し\n\nCI環境での日本語フォントテストです。';

    await page.fill('input[placeholder*="ノートのタイトル"]', japaneseTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', japaneseContent);

    // Verify the text was entered correctly
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue(japaneseTitle);
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue(japaneseContent);
  });

  test('レスポンシブデザインが機能する', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });

    // Wait for page to be loaded
    await page.waitForSelector('h1', { timeout: 15000 });

    // Test different viewport sizes
    const viewports = [
      { width: 1200, height: 800 },  // Desktop
      { width: 768, height: 1024 },  // Tablet
      { width: 375, height: 667 }    // Mobile
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);

      // Basic elements should be visible at all sizes
      await expect(page.locator('h1')).toBeVisible();
      await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toBeVisible();
      await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toBeVisible();
    }
  });

  test('アプリケーションのメタデータが正しい', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });

    // Check page title
    await expect(page).toHaveTitle(/Simplenotebook/);

    // Check that the main heading is present
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });
});
