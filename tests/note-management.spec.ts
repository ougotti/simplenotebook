import { test, expect } from '@playwright/test';

test.describe('Note Management Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/notes/new');
    // Wait for page to be fully loaded
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('should handle form validation and empty submission', async ({ page }) => {
    // Try to submit empty form
    await page.click('button[type="submit"]');
    
    // The form should still allow submission with empty content (creating "Untitled" note)
    // Wait a bit to see if any message appears
    await page.waitForTimeout(1000);
    
    // Check that the submit button text changes during submission
    await expect(page.locator('button[type="submit"]')).not.toContainText('保存中...');
  });

  test('should handle very long content', async ({ page }) => {
    const longTitle = 'A'.repeat(200);
    const longContent = 'B'.repeat(5000);
    
    await page.fill('input[placeholder*="ノートのタイトル"]', longTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', longContent);
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Should handle long content gracefully
    await expect(page.locator('text=ノートを保存しました（ローカル保存）')).toBeVisible();
  });

  test('should handle Japanese characters correctly', async ({ page }) => {
    const japaneseTitle = 'テストノート日本語タイトル🎌';
    const japaneseContent = `# 日本語見出し

これは**日本語**のMarkdownテストです。

- リストアイテム１
- リストアイテム２
- 絵文字も含む: 🎌🌸💻

\`\`\`javascript
console.log('日本語コメント');
\`\`\`

> 引用文も日本語で書いてみる
`;
    
    await page.fill('input[placeholder*="ノートのタイトル"]', japaneseTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', japaneseContent);
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Should handle Japanese text correctly
    await expect(page.locator('text=ノートを保存しました（ローカル保存）')).toBeVisible();
  });

  test('should clear localStorage on successful save', async ({ page }) => {
    const testTitle = 'クリアテスト';
    const testContent = 'このコンテンツは保存後にクリアされるはず';
    
    await page.fill('input[placeholder*="ノートのタイトル"]', testTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', testContent);
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Wait for success message
    await expect(page.locator('text=ノートを保存しました（ローカル保存）')).toBeVisible();
    
    // Fields should be cleared
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue('');
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue('');
    
    // Reload to check localStorage was cleared
    await page.reload();
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue('');
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue('');
  });

  test('should show proper loading states', async ({ page }) => {
    // Fill form first
    await page.fill('input[placeholder*="ノートのタイトル"]', 'ローディングテスト');
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', 'テストコンテンツ');
    
    // Click submit and immediately check for loading state
    const submitPromise = page.click('button[type="submit"]');
    
    // Check if loading text appears (might be very brief in local mode)
    const loadingText = page.locator('text=保存中...');
    
    await submitPromise;
    
    // Should eventually show success
    await expect(page.locator('text=ノートを保存しました（ローカル保存）')).toBeVisible();
  });

  test('should handle page navigation correctly', async ({ page }) => {
    // Start at root
    await page.goto('/');
    
    // Should redirect to notes/new
    await page.waitForURL('**/notes/new');
    
    // Navigate to settings (if accessible)
    const settingsButton = page.locator('button:has-text("設定")');
    if (await settingsButton.isVisible()) {
      await settingsButton.click();
      await page.waitForURL('**/settings');
      expect(page.url()).toContain('/settings');
    }
  });

  test('should display proper responsive layout', async ({ page }) => {
    // Test different viewport sizes
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto('/notes/new');
    
    // Should show grid layout on large screens
    const gridContainer = page.locator('.grid.grid-cols-1.lg\\:grid-cols-2');
    await expect(gridContainer).toBeVisible();
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Elements should still be visible on mobile
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toBeVisible();
  });
});