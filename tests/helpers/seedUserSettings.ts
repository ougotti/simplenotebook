import { Page } from '@playwright/test';

/**
 * ローカルモードの初回設定モーダルが表示されないよう、
 * ページ読み込み前に userSettings を localStorage にシードする。
 */
export async function seedUserSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'userSettings',
      JSON.stringify({
        displayName: 'テストユーザー',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    );
  });
}
