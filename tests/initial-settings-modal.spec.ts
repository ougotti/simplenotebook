import { test, expect } from '@playwright/test';

test.describe('Initial Settings Modal', () => {
  test('should show the initial settings modal when userSettings is missing and save it', async ({ page }) => {
    // userSettings をシードしない状態でアクセスし、初回設定モーダルが表示されることを確認
    // baseURL に basePath ('/simplenotebook') が含まれる場合、先頭 '/' の相対パスは
    // basePath を無視してしまうため、basePath を含む絶対パスで遷移する
    await page.goto('/simplenotebook/notes/new', { waitUntil: 'networkidle' });

    const modal = page.locator('div[role="dialog"][aria-modal="true"]');
    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.locator('#modal-title')).toContainText('初回設定');

    // 表示名を入力して保存
    await modal.locator('#displayName').fill('テストユーザー');
    await modal.locator('button[type="submit"]').click();

    // 保存後はモーダルが閉じ、/notes/new に遷移する
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    await page.waitForURL('**/notes/new', { timeout: 10000 });

    // localStorage に userSettings が保存されていることを確認
    const savedSettings = await page.evaluate(() => localStorage.getItem('userSettings'));
    expect(savedSettings).not.toBeNull();
    expect(JSON.parse(savedSettings!)).toMatchObject({ displayName: 'テストユーザー' });
  });
});
