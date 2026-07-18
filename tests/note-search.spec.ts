import { test, expect, Page } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

async function createNote(page: Page, title: string, content: string) {
  await page.fill('input[placeholder*="ノートのタイトル"]', title);
  await page.fill('textarea[placeholder*="Markdownを書いてください"]', content);
  await page.click('button[type="submit"]');
  await expect(page.locator('text=ノートを保存しました（ローカル保存）')).toBeVisible();
}

test.describe('Note Search (B-01)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await page.goto(appPath('/notes/new'));
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
    await createNote(page, '買い物リスト', '- 牛乳\n- パン');
    await createNote(page, '会議メモ', '来週のスプリント計画について議論する');
  });

  test('タイトルでリアルタイムに絞り込める', async ({ page }) => {
    const search = page.getByTestId('note-search');
    await search.fill('買い物');

    await expect(page.locator('h3', { hasText: '買い物リスト' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '会議メモ' })).not.toBeVisible();
  });

  test('本文でも検索できる', async ({ page }) => {
    const search = page.getByTestId('note-search');
    await search.fill('スプリント');

    await expect(page.locator('h3', { hasText: '会議メモ' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '買い物リスト' })).not.toBeVisible();
  });

  test('0件時にメッセージが表示され、クリアで全件に戻る', async ({ page }) => {
    const search = page.getByTestId('note-search');
    await search.fill('存在しないキーワードXYZ');

    await expect(page.getByTestId('search-no-results')).toBeVisible();

    await page.click('button[aria-label="検索をクリア"]');
    await expect(search).toHaveValue('');
    await expect(page.locator('h3', { hasText: '買い物リスト' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '会議メモ' })).toBeVisible();
  });
});
