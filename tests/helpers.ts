import { Page } from '@playwright/test';

/**
 * Seed user settings into localStorage before the app loads so the
 * first-time settings modal (初回設定) does not block interactions.
 * Must be called before the first page.goto() of the test.
 */
export async function seedUserSettings(page: Page) {
  await page.addInitScript(() => {
    const now = new Date().toISOString();
    localStorage.setItem(
      'userSettings',
      JSON.stringify({
        displayName: 'テストユーザー',
        createdAt: now,
        updatedAt: now,
      })
    );
  });
}
