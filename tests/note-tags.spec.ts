import { test, expect, Page } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

async function createNoteWithTags(page: Page, title: string, content: string, tags: string[]) {
  await page.fill('input[placeholder*="ノートのタイトル"]', title);
  await page.fill('textarea[placeholder*="Markdownを書いてください"]', content);
  for (const tag of tags) {
    await page.getByLabel('タグを追加').fill(tag);
    await page.getByLabel('タグを追加').press('Enter');
  }
  await page.click('button[type="submit"]');
  await expect(page.locator('text=保存しました')).toBeVisible();
}

test.describe('Note Tags (B-03)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await page.goto(appPath('/notes/new'));
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('タグを付与して保存すると一覧にタグが表示される', async ({ page }) => {
    await createNoteWithTags(page, '仕事メモ', '会議の議事録', ['仕事', '会議']);

    const card = page.locator('.border.rounded').filter({ hasText: '仕事メモ' });
    await expect(card.getByTestId('note-tag').filter({ hasText: '仕事' })).toBeVisible();
    await expect(card.getByTestId('note-tag').filter({ hasText: '会議' })).toBeVisible();
  });

  test('タグクリックで絞り込まれ、解除で全件に戻る', async ({ page }) => {
    await createNoteWithTags(page, '仕事メモ', '会議の議事録', ['仕事']);
    await createNoteWithTags(page, '買い物リスト', '- 牛乳', ['プライベート']);

    // タグ「仕事」で絞り込み
    await page.getByTestId('note-tag').filter({ hasText: '仕事' }).click();
    await expect(page.getByTestId('active-tag-filter')).toContainText('仕事');
    await expect(page.locator('h3', { hasText: '仕事メモ' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '買い物リスト' })).not.toBeVisible();

    // 絞り込み解除で全件表示
    await page.getByTestId('active-tag-filter').click();
    await expect(page.locator('h3', { hasText: '仕事メモ' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '買い物リスト' })).toBeVisible();
  });

  test('編集でタグを追加・削除できる', async ({ page }) => {
    await createNoteWithTags(page, '編集対象', '本文', ['旧タグ']);

    // 編集モードに入るとタグが復元される
    await page.locator('.border.rounded').filter({ hasText: '編集対象' }).getByRole('button', { name: '編集' }).click();
    await expect(page.getByTestId('tag-input').getByTestId('tag-chip').filter({ hasText: '旧タグ' })).toBeVisible();

    // 旧タグを削除して新タグを追加
    await page.getByLabel('タグ「旧タグ」を削除').click();
    await page.getByLabel('タグを追加').fill('新タグ');
    await page.getByLabel('タグを追加').press('Enter');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=ノートを更新しました')).toBeVisible();

    const card = page.locator('.border.rounded').filter({ hasText: '編集対象' });
    await expect(card.getByTestId('note-tag').filter({ hasText: '新タグ' })).toBeVisible();
    await expect(card.getByTestId('note-tag').filter({ hasText: '旧タグ' })).not.toBeVisible();
  });

  test('タグがリロード後も維持される', async ({ page }) => {
    await createNoteWithTags(page, '永続化テスト', '本文', ['保持タグ']);

    await page.reload();
    await expect(page.locator('h1')).toContainText('SimpleNotebook');

    const card = page.locator('.border.rounded').filter({ hasText: '永続化テスト' });
    await expect(card.getByTestId('note-tag').filter({ hasText: '保持タグ' })).toBeVisible();
  });

  test('検索とタグ絞り込みを併用できる (AND 条件)', async ({ page }) => {
    await createNoteWithTags(page, '会議メモA', 'スプリント計画', ['仕事']);
    await createNoteWithTags(page, '会議メモB', '雑談', ['仕事']);
    await createNoteWithTags(page, '個人メモ', 'スプリント自習', ['プライベート']);

    await page.getByTestId('note-tag').filter({ hasText: '仕事' }).first().click();
    await page.getByTestId('note-search').fill('スプリント');

    await expect(page.locator('h3', { hasText: '会議メモA' })).toBeVisible();
    await expect(page.locator('h3', { hasText: '会議メモB' })).not.toBeVisible();
    await expect(page.locator('h3', { hasText: '個人メモ' })).not.toBeVisible();
  });
});
