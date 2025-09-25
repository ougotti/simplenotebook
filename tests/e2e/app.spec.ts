import { test, expect } from '@playwright/test';

test.describe('SimpleNotebook App', () => {
  test('should redirect from homepage to notes/new', async ({ page }) => {
    await page.goto('/');
    
    // Wait for redirect to complete
    await page.waitForURL('**/notes/new');
    
    // Check that we're now on the notes/new page
    expect(page.url()).toContain('/notes/new');
  });

  test('should display the main interface in local mode', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Since we're using placeholder config values, the app should be in local mode
    // The auth hook should automatically set the user to LOCAL_USER
    
    // Wait for the app to load and show the main interface
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Check for main UI elements
    await expect(page.locator('text=新規ノート')).toBeVisible();
    await expect(page.locator('text=保存されたノート')).toBeVisible();
    
    // Check for form elements
    await expect(page.locator('input[placeholder="ノートのタイトル"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder="Markdownを書いてください..."]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('should create a note with localStorage persistence', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    const noteTitle = 'テストノート';
    const noteContent = '# テストタイトル\n\n**太字のテキスト**\n\n- リスト項目 1\n- リスト項目 2';
    
    // Fill in the note form
    await page.locator('input[placeholder="ノートのタイトル"]').fill(noteTitle);
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill(noteContent);
    
    // Check localStorage persistence during typing
    const titleInStorage = await page.evaluate(() => localStorage.getItem('new-note-title'));
    const contentInStorage = await page.evaluate(() => localStorage.getItem('new-note-content'));
    
    expect(titleInStorage).toBe(noteTitle);
    expect(contentInStorage).toBe(noteContent);
    
    // Submit the form (this would make API call but should show mock response in local mode)
    await page.click('button[type="submit"]');
    
    // In local mode, this would typically show an error since the API is mocked
    // But we should see the attempt was made
  });

  test('should support Japanese text input and display', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    const japaneseText = 'こんにちは、世界！\n日本語のテキストです。\n🎌 絵文字も使えます。';
    
    // Fill in Japanese text
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill(japaneseText);
    
    // Verify the text was entered correctly
    await expect(page.locator('textarea[placeholder="Markdownを書いてください..."]')).toHaveValue(japaneseText);
    
    // Check that Japanese text is properly saved in localStorage
    const storedContent = await page.evaluate(() => localStorage.getItem('new-note-content'));
    expect(storedContent).toBe(japaneseText);
  });

  test('should handle form interactions', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Initially the save button should be enabled (even without content)
    const saveButton = page.locator('button[type="submit"]');
    await expect(saveButton).toBeEnabled();
    
    // Fill the form
    await page.locator('input[placeholder="ノートのタイトル"]').fill('Test Title');
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill('Test content');
    
    // Button should still be enabled
    await expect(saveButton).toBeEnabled();
    await expect(saveButton).toHaveText('保存');
  });

  test('should show user information in header', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // In local mode, should show the local user info
    await expect(page.locator('text=local@example.com')).toBeVisible();
    await expect(page.locator('text=サインアウト')).toBeVisible();
  });

  test('should maintain state across page reloads', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    const testTitle = 'Persistent Test';
    const testContent = 'This content should persist';
    
    // Fill in the form
    await page.locator('input[placeholder="ノートのタイトル"]').fill(testTitle);
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill(testContent);
    
    // Reload the page
    await page.reload();
    
    // Wait for the interface to load again
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Check that the form data was restored from localStorage
    await expect(page.locator('input[placeholder="ノートのタイトル"]')).toHaveValue(testTitle);
    await expect(page.locator('textarea[placeholder="Markdownを書いてください..."]')).toHaveValue(testContent);
  });
});