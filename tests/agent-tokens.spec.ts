import { test, expect, Page } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

function section(page: Page) {
  return page.getByTestId('agent-tokens');
}

async function issueToken(page: Page, name: string, options: { write?: boolean; days?: string } = {}) {
  await section(page).getByLabel('名前').fill(name);
  if (options.write) {
    await section(page).getByRole('checkbox', { name: /書き込み/ }).check();
  }
  if (options.days) {
    await section(page).getByLabel('有効期限').selectOption(options.days);
  }
  await section(page).getByRole('button', { name: '発行する' }).click();
  await expect(page.getByTestId('issued-token')).toBeVisible();
}

test.describe('エージェント連携 (B-17)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
    await page.goto(appPath('/settings'));
    await expect(section(page).getByRole('heading', { name: 'エージェント連携' })).toBeVisible();
  });

  test('初期状態はトークンなし。権限は読み取りのみ選択済みで、削除は選べない', async ({ page }) => {
    await expect(page.getByTestId('no-tokens')).toBeVisible();
    await expect(section(page).getByRole('checkbox', { name: /読み取り/ })).toBeChecked();
    await expect(section(page).getByRole('checkbox', { name: /書き込み/ })).not.toBeChecked();
    await expect(section(page).getByRole('checkbox', { name: /削除/ })).toHaveCount(0);
    await expect(section(page).getByLabel('有効期限')).toHaveValue('30');
    // 最長 90 日
    const options = await section(page).getByLabel('有効期限').locator('option').allTextContents();
    expect(options).toEqual(['7 日', '30 日', '60 日', '90 日']);
  });

  test('発行するとトークンが一度だけ表示され、一覧に追加される', async ({ page }) => {
    await issueToken(page, 'Claude Code (ノートPC)', { write: true, days: '90' });

    const token = await page.getByTestId('issued-token-value').textContent();
    expect(token).toMatch(/^snb_local_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByTestId('curl-example')).toContainText(`Authorization: Bearer ${token}`);
    // MCP の URL が提供されていなければ、MCP の接続例は出さずに案内だけ表示する
    await expect(page.getByTestId('claude-code-example')).toHaveCount(0);
    await expect(page.getByTestId('issued-token')).toContainText('MCP サーバーの提供開始後');

    const row = page.getByTestId('token-row').filter({ hasText: 'Claude Code (ノートPC)' });
    await expect(row).toHaveAttribute('data-status', 'active');
    await expect(row).toContainText('権限: 読み取り・書き込み');
    await expect(row).toContainText('最終使用: 未使用');

    // 閉じたら平文は二度と表示されない(リロード後も)
    await page.getByRole('button', { name: '保存したので閉じる' }).click();
    await expect(page.getByTestId('issued-token')).toHaveCount(0);
    await page.reload();
    await expect(row).toBeVisible();
    await expect(page.getByTestId('issued-token')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(token!);
  });

  test('名前が空・権限なしでは発行できない', async ({ page }) => {
    await section(page).getByRole('button', { name: '発行する' }).click();
    await expect(section(page).getByRole('alert')).toHaveText('トークンの名前を入力してください。');

    await section(page).getByLabel('名前').fill('権限なし');
    await section(page).getByRole('checkbox', { name: /読み取り/ }).uncheck();
    await section(page).getByRole('button', { name: '発行する' }).click();
    await expect(section(page).getByRole('alert')).toHaveText('権限を 1 つ以上選んでください。');
    await expect(page.getByTestId('issued-token')).toHaveCount(0);
    await expect(page.getByTestId('no-tokens')).toBeVisible();
  });

  test('確認してから失効でき、キャンセルもできる', async ({ page }) => {
    await issueToken(page, '失効テスト');
    const row = page.getByTestId('token-row').filter({ hasText: '失効テスト' });

    await row.getByRole('button', { name: '失効', exact: true }).click();
    await row.getByRole('button', { name: 'キャンセル' }).click();
    await expect(row).toHaveAttribute('data-status', 'active');

    await row.getByRole('button', { name: '失効', exact: true }).click();
    await row.getByRole('button', { name: '失効する' }).click();
    await expect(row).toHaveAttribute('data-status', 'revoked');
    await expect(row.getByTestId('token-status')).toHaveText('失効済み');
    // 失効済みのトークンには失効ボタンを出さない
    await expect(row.getByRole('button', { name: '失効', exact: true })).toHaveCount(0);
  });
});

test.describe('エージェント連携: MCP の接続例 (B-19)', () => {
  const MCP_URL = 'https://mcp.notes.test/mcp';

  test.beforeEach(async ({ page }) => {
    // デプロイ後の config.json と同じく mcpUrl が入っている状態にする(ほかの値は開発モードのまま)
    await page.route('**/config/config.json', async route => {
      const response = await route.fetch();
      const config = await response.json();
      await route.fulfill({ response, json: { ...config, mcpUrl: MCP_URL } });
    });
    await seedUserSettings(page);
    await page.goto(appPath('/settings'));
    await expect(section(page).getByRole('heading', { name: 'エージェント連携' })).toBeVisible();
  });

  test('発行直後に Claude Code と Codex の接続例を表示する', async ({ page }) => {
    await issueToken(page, 'Claude Code', { write: true });
    const token = await page.getByTestId('issued-token-value').textContent();

    await expect(page.getByTestId('claude-code-example')).toHaveText(
      `claude mcp add --transport http simplenotebook ${MCP_URL} --header "Authorization: Bearer ${token}"`
    );
    const codex = page.getByTestId('codex-example');
    await expect(codex).toContainText('[mcp_servers.simplenotebook]');
    await expect(codex).toContainText(`url = "${MCP_URL}"`);
    await expect(codex).toContainText('bearer_token_env_var = "SIMPLENOTEBOOK_TOKEN"');
    // 平文のトークンは設定ファイルに書かせない(環境変数で渡す)
    await expect(codex).not.toContainText(token!);
    await expect(page.getByTestId('curl-example')).toBeVisible();
    await expect(page.getByTestId('issued-token')).not.toContainText('MCP サーバーの提供開始後');
  });
});
