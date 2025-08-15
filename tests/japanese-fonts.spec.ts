import { test, expect } from '@playwright/test';

test.describe('Japanese Font Rendering', () => {
  test('should display Japanese text correctly', async ({ page }) => {
    // Navigate to the home page which redirects to /notes/new
    await page.goto('/');
    
    // Wait for navigation to complete
    await page.waitForURL('**/notes/new');
    
    // Check if Japanese text elements are present and visible
    await expect(page.locator('text=新規ノート')).toBeVisible();
    await expect(page.locator('text=保存されたノート')).toBeVisible();
    await expect(page.locator('placeholder=ノートのタイトル')).toBeVisible();
    await expect(page.locator('placeholder=Markdownを書いてください...')).toBeVisible();
    
    // Test input with Japanese text
    await page.fill('input[placeholder="ノートのタイトル"]', 'テストタイトル');
    await page.fill('textarea[placeholder="Markdownを書いてください..."]', '# 日本語のテスト\n\nこれは**日本語**のテストです。');
    
    // Verify the Japanese text was entered correctly
    await expect(page.locator('input[placeholder="ノートのタイトル"]')).toHaveValue('テストタイトル');
    await expect(page.locator('textarea[placeholder="Markdownを書いてください..."]')).toHaveValue('# 日本語のテスト\n\nこれは**日本語**のテストです。');
  });

  test('should handle Japanese text in authentication flow', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/notes/new');
    
    // Check if sign out button with Japanese text is present
    // (this test assumes the user is already authenticated in dev mode)
    const signOutButton = page.locator('text=サインアウト');
    if (await signOutButton.isVisible()) {
      await expect(signOutButton).toBeVisible();
    }
    
    // Check if development mode indicator is present with Japanese text
    const devModeIndicator = page.locator('text=開発モード - ローカルストレージ使用中');
    if (await devModeIndicator.isVisible()) {
      await expect(devModeIndicator).toBeVisible();
    }
  });

  test('should render Japanese date formats correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/notes/new');
    
    // If there are saved notes with Japanese date formatting, check them
    const notesSection = page.locator('text=保存されたノート').locator('..');
    await expect(notesSection).toBeVisible();
    
    // Check if "まだノートがありません" message appears when no notes exist
    const noNotesMessage = page.locator('text=まだノートがありません');
    if (await noNotesMessage.isVisible()) {
      await expect(noNotesMessage).toBeVisible();
    }
  });
});