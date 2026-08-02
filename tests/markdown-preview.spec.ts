import { test, expect } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

const MARKDOWN_SAMPLE = `# 見出し1

これは **強調** を含む段落です。

- リスト項目A
- リスト項目B

> 引用ブロック

\`\`\`javascript
const greeting = 'こんにちは';
console.log(greeting);
\`\`\`

| 列1 | 列2 |
| --- | --- |
| あ | い |
`;

test.describe('Markdown Preview (B-04)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await page.goto(appPath('/notes/new'));
    await expect(page.locator('h1')).toContainText('SimpleNotebook');
  });

  test('タブで編集とプレビューを切り替えられる', async ({ page }) => {
    const textarea = page.locator('textarea[placeholder*="Markdownを書いてください"]');
    await expect(textarea).toBeVisible();

    await page.getByTestId('tab-preview').click();
    await expect(page.getByTestId('markdown-preview')).toBeVisible();
    await expect(textarea).not.toBeVisible();

    await page.getByTestId('tab-edit').click();
    await expect(textarea).toBeVisible();
    await expect(page.getByTestId('markdown-preview')).not.toBeVisible();
  });

  test('GFM がレンダリングされる (見出し・リスト・引用・テーブル)', async ({ page }) => {
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', MARKDOWN_SAMPLE);
    await page.getByTestId('tab-preview').click();

    const preview = page.getByTestId('markdown-preview');
    await expect(preview.locator('h1')).toContainText('見出し1');
    await expect(preview.locator('strong')).toContainText('強調');
    await expect(preview.locator('li')).toHaveCount(2);
    await expect(preview.locator('blockquote')).toContainText('引用ブロック');
    await expect(preview.locator('table td').first()).toContainText('あ');
  });

  test('コードブロックがシンタックスハイライトされる', async ({ page }) => {
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', MARKDOWN_SAMPLE);
    await page.getByTestId('tab-preview').click();

    const preview = page.getByTestId('markdown-preview');
    // rehype-highlight が言語クラスとトークン span を付与していること
    await expect(preview.locator('code.language-javascript')).toBeVisible();
    await expect(preview.locator('.hljs-keyword').first()).toContainText('const');
    await expect(preview.locator('.hljs-string').first()).toContainText('こんにちは');
  });

  test('内容が空のときはプレースホルダを表示する', async ({ page }) => {
    await page.getByTestId('tab-preview').click();
    await expect(page.getByTestId('markdown-preview')).toContainText('プレビューする内容がありません');
  });

  test('保存後は編集タブに戻り、プレビュー内容もクリアされる', async ({ page }) => {
    await page.fill('input[placeholder*="ノートのタイトル"]', 'プレビューテスト');
    await page.fill('textarea[placeholder*="Markdownを書いてください"]', MARKDOWN_SAMPLE);
    await page.getByTestId('tab-preview').click();
    await expect(page.getByTestId('markdown-preview').locator('h1')).toBeVisible();

    await page.click('button[type="submit"]');
    await expect(page.locator('text=保存しました')).toBeVisible();

    // 保存後は編集タブへ戻り、フォームはクリアされている
    await expect(page.locator('textarea[placeholder*="Markdownを書いてください"]')).toHaveValue('');
  });
});
