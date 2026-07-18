import { test, expect } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

test.describe('Dark Mode (B-02)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await page.goto(appPath('/notes/new'));
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('トグルでダークモードに切り替わる', async ({ page }) => {
    const html = page.locator('html');
    await expect(html).not.toHaveClass(/dark/);

    await page.getByTestId('theme-toggle').click();
    await expect(html).toHaveClass(/dark/);

    await page.getByTestId('theme-toggle').click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('選択したテーマがリロード後も維持される', async ({ page }) => {
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveClass(/dark/);

    await page.reload();
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
    await expect(page.locator('html')).toHaveClass(/dark/);

    const stored = await page.evaluate(() => window.localStorage.getItem('theme'));
    expect(stored).toBe('dark');
  });

  test('OS 設定 (prefers-color-scheme) に追従する', async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: 'dark' });
    const darkPage = await context.newPage();
    await seedUserSettings(darkPage);
    await darkPage.goto(appPath('/notes/new'));
    await expect(darkPage.locator('h1')).toContainText('SimpleNotebook');
    await expect(darkPage.locator('html')).toHaveClass(/dark/);
    await context.close();
  });
});
