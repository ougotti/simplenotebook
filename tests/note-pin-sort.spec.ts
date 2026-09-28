import { test, expect, Page } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

const NOTES_KEY = 'simplenotebook_notes';

interface SeedNote {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
}

// 日時を制御した状態で並び順を検証するため、ローカルストレージに直接ノートを用意する
async function seedNotes(page: Page, notes: SeedNote[]) {
  await page.addInitScript(
    ({ key, notes }) => {
      // リロード後の永続化を検証できるよう、初回ロード時だけ投入する
      if (window.sessionStorage.getItem('notes-seeded')) return;
      window.sessionStorage.setItem('notes-seeded', '1');
      window.localStorage.setItem(
        key,
        JSON.stringify(notes.map(n => ({ content: '', tags: [], ...n })))
      );
    },
    { key: NOTES_KEY, notes }
  );
}

function titles(page: Page) {
  return page.getByTestId('note-card').locator('h3');
}

function card(page: Page, title: string) {
  return page.getByTestId('note-card').filter({ has: page.locator('h3', { hasText: title }) });
}

// 作成日時: さくら < あおい < かえで / 更新日時: あおい < かえで < さくら / タイトル: あ < か < さ
const SEED: SeedNote[] = [
  { id: 'note-a', title: 'さくら', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-03-01T00:00:00.000Z' },
  { id: 'note-b', title: 'あおい', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' },
  { id: 'note-c', title: 'かえで', createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z' },
];

test.describe('Note Pin & Sort (B-05)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await seedNotes(page, SEED);
    await page.goto(appPath('/notes/new'));
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
    await expect(titles(page)).toHaveCount(3);
  });

  test('既定は更新日時の新しい順で表示される', async ({ page }) => {
    await expect(page.getByTestId('note-sort')).toHaveValue('updatedAt');
    await expect(titles(page)).toHaveText(['さくら', 'かえで', 'あおい']);
  });

  test('並び替えを作成日時順・タイトル順に切り替えられ、リロード後も維持される', async ({ page }) => {
    await page.getByTestId('note-sort').selectOption('createdAt');
    await expect(titles(page)).toHaveText(['かえで', 'あおい', 'さくら']);

    await page.getByTestId('note-sort').selectOption('title');
    await expect(titles(page)).toHaveText(['あおい', 'かえで', 'さくら']);

    await page.reload();
    await expect(page.getByTestId('note-sort')).toHaveValue('title');
    await expect(titles(page)).toHaveText(['あおい', 'かえで', 'さくら']);
  });

  test('ピン留めしたノートが上部に表示され、解除すると元の位置に戻る', async ({ page }) => {
    await card(page, 'あおい').getByTestId('pin-toggle').click();

    await expect(card(page, 'あおい')).toHaveAttribute('data-pinned', 'true');
    await expect(card(page, 'あおい').getByTestId('pin-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(titles(page)).toHaveText(['あおい', 'さくら', 'かえで']);

    await card(page, 'あおい').getByTestId('pin-toggle').click();

    await expect(card(page, 'あおい')).toHaveAttribute('data-pinned', 'false');
    await expect(titles(page)).toHaveText(['さくら', 'かえで', 'あおい']);
  });

  test('ピン留めノート同士も選択中の並び順で並ぶ', async ({ page }) => {
    await card(page, 'あおい').getByTestId('pin-toggle').click();
    await card(page, 'かえで').getByTestId('pin-toggle').click();
    await expect(titles(page)).toHaveText(['かえで', 'あおい', 'さくら']);

    await page.getByTestId('note-sort').selectOption('title');
    await expect(titles(page)).toHaveText(['あおい', 'かえで', 'さくら']);
  });

  test('ピン留めは更新日時を変えず、リロード後も維持される', async ({ page }) => {
    await card(page, 'あおい').getByTestId('pin-toggle').click();
    await expect(card(page, 'あおい')).toHaveAttribute('data-pinned', 'true');

    await page.reload();
    await expect(titles(page)).toHaveText(['あおい', 'さくら', 'かえで']);
    await expect(card(page, 'あおい')).toHaveAttribute('data-pinned', 'true');

    // ピン留めだけでは「更新:」表示(updatedAt !== createdAt)が出ない
    await expect(card(page, 'あおい')).not.toContainText('更新:');
  });

  test('ピン留め状態は編集して保存しても保持される', async ({ page }) => {
    await card(page, 'かえで').getByTestId('pin-toggle').click();
    await expect(card(page, 'かえで')).toHaveAttribute('data-pinned', 'true');

    await card(page, 'かえで').getByRole('button', { name: '編集' }).click();
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', '追記した本文');
    await page.click('button[type="submit"]');
    await expect(page.locator('text=ノートを更新しました')).toBeVisible();

    await expect(card(page, 'かえで')).toHaveAttribute('data-pinned', 'true');
    await expect(titles(page).first()).toHaveText('かえで');
  });
});
