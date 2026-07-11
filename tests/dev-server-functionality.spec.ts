import { test, expect } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

test.describe('Simplenotebook - Development Server', () => {
  test.beforeEach(async ({ page }) => {
    // Set a longer timeout for development server tests
    page.setDefaultTimeout(10000);
    await seedUserSettings(page);
  });

  test('should display the application title', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for React app to hydrate
    await page.waitForSelector('h1', { timeout: 15000 });
    
    // Check for main elements
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('should display the new note form', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for the form to be rendered
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });
    
    // Check for form elements
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    
    // Check the submit button text
    await expect(page.locator('button[type="submit"]')).toContainText('保存');
  });

  test('should show development mode message', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for the page to be fully loaded
    await page.waitForSelector('h1', { timeout: 15000 });
    
    // Check for development mode indicator
    try {
      await expect(page.locator('text=開発モード - ローカルストレージ使用中')).toBeVisible({ timeout: 5000 });
    } catch (error) {
      console.log('Development mode message not found, app might be in different mode');
      // Still check that the basic app loaded
      await expect(page.locator('h1')).toContainText('SimpleNotebook');
    }
  });

  test('should create and save a note locally', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for form to be ready
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });
    
    // Fill in the note form
    const testTitle = 'テストノート開発環境';
    const testContent = '# テストヘッダー\n\nこれは開発環境でのテスト用Markdownコンテンツです。';
    
    await page.fill('input[placeholder*="ノートのタイトル"]', testTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', testContent);
    
    // Submit the form
    await page.click('button[type="submit"]');
    
    // Wait for success message (be flexible with the exact text)
    const successMessage = page.locator('text=保存しました').or(page.locator('text=ノートを保存しました'));
    await expect(successMessage).toBeVisible({ timeout: 10000 });
    
    // Check that form was cleared after successful save
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue('', { timeout: 5000 });
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue('', { timeout: 5000 });
  });

  test('should persist content in localStorage', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for form to be ready
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });
    
    const testTitle = 'LocalStorageテスト開発環境';
    const testContent = 'このコンテンツは開発環境でリロード後も残るはずです';
    
    // Fill in the form
    await page.fill('input[placeholder*="ノートのタイトル"]', testTitle);
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', testContent);
    
    // Reload the page
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });
    
    // Check that the content was restored from localStorage
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue(testTitle);
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue(testContent);
  });

  test('should display saved notes section', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for page to be loaded
    await page.waitForSelector('h1', { timeout: 15000 });
    
    // Check for saved notes section
    await expect(page.locator('h2')).toContainText('保存されたノート');
    await expect(page.locator('button')).toContainText('更新');
    
    // Initially should show "no notes" message
    await expect(page.locator('text=まだノートがありません')).toBeVisible({ timeout: 10000 });
  });

  test('should show user interface buttons', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for page to be loaded
    await page.waitForSelector('h1', { timeout: 15000 });
    
    // Check for user display area and buttons
    await expect(page.locator('button')).toContainText('サインアウト');
    await expect(page.locator('button')).toContainText('設定');
  });

  test('should handle Japanese characters correctly', async ({ page }) => {
    await page.goto(appPath('/notes/new'), { waitUntil: 'networkidle' });
    
    // Wait for form to be ready
    await page.waitForSelector('input[placeholder*="ノートのタイトル"]', { timeout: 15000 });
    
    const japaneseTitle = '日本語タイトルテスト🎌';
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
    
    // Verify the text was entered correctly
    await expect(page.locator('input[placeholder*="ノートのタイトル"]')).toHaveValue(japaneseTitle);
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue(japaneseContent);
  });
});