import { test, expect, Page } from '@playwright/test';
import { seedUserSettings } from './helpers/seedUserSettings';
import { appPath } from './helpers/paths';

const MCP_ORIGIN = 'https://mcp.notes.test';
const REQUEST_ID = 'ABCDEFGHJKMNPQRS';
const CALLBACK = 'https://client.test/callback';

const AUTH_REQUEST = {
  requestId: REQUEST_ID,
  clientName: 'Claude',
  redirectUri: CALLBACK,
  redirectHost: 'client.test',
  scopes: ['notes:read', 'notes:write'],
  expiresAt: '2099-01-01T00:00:00.000Z',
};

/** デプロイ後と同じく mcpUrl がある状態にし、OAuth の API と戻り先(接続元のアプリ)を差し替える */
async function mockOAuth(page: Page, options: { requestStatus?: number } = {}) {
  const decisions: unknown[] = [];
  await page.route('**/config/config.json', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), mcpUrl: `${MCP_ORIGIN}/mcp` } });
  });
  await page.route(`${MCP_ORIGIN}/oauth/requests/*`, route =>
    options.requestStatus
      ? route.fulfill({ status: options.requestStatus, json: { error: 'request_not_found', error_description: 'The authorization request has expired or has already been used.' } })
      : route.fulfill({ json: AUTH_REQUEST })
  );
  await page.route(`${MCP_ORIGIN}/oauth/approve`, async route => {
    const body = route.request().postDataJSON();
    decisions.push(body);
    const redirectUrl = body.approve
      ? `${CALLBACK}?code=test-code&state=xyz`
      : `${CALLBACK}?error=access_denied&state=xyz`;
    await route.fulfill({ json: { redirectUrl } });
  });
  await page.route(`${CALLBACK}**`, route => route.fulfill({ contentType: 'text/html', body: '<h1>client callback</h1>' }));
  return decisions;
}

test.describe('OAuth 同意画面 (B-20)', () => {
  test.beforeEach(async ({ page }) => {
    await seedUserSettings(page);
  });

  test('クライアント名と戻り先のホストを表示し、選んだ権限だけで許可できる', async ({ page }) => {
    const decisions = await mockOAuth(page);
    await page.goto(appPath(`/oauth/consent?req=${REQUEST_ID}`));

    await expect(page.getByTestId('consent-client-name')).toHaveText('Claude');
    await expect(page.getByTestId('consent-redirect-host')).toHaveText('client.test');
    await expect(page.getByRole('checkbox', { name: /読み取り/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /書き込み/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /削除/ })).toHaveCount(0);

    await page.getByRole('checkbox', { name: /書き込み/ }).uncheck();
    await page.getByRole('button', { name: '許可する' }).click();

    await page.waitForURL(`${CALLBACK}?code=test-code&state=xyz`);
    expect(decisions).toEqual([{ requestId: REQUEST_ID, approve: true, scopes: ['notes:read'] }]);
  });

  test('拒否すると access_denied で戻り先へ遷移する', async ({ page }) => {
    const decisions = await mockOAuth(page);
    await page.goto(appPath(`/oauth/consent?req=${REQUEST_ID}`));
    await page.getByRole('button', { name: '拒否する' }).click();

    await page.waitForURL(`${CALLBACK}?error=access_denied&state=xyz`);
    expect(decisions).toEqual([{ requestId: REQUEST_ID, approve: false }]);
  });

  test('権限を 1 つも選ばなければ許可できない', async ({ page }) => {
    const decisions = await mockOAuth(page);
    await page.goto(appPath(`/oauth/consent?req=${REQUEST_ID}`));
    await page.getByRole('checkbox', { name: /読み取り/ }).uncheck();
    await page.getByRole('checkbox', { name: /書き込み/ }).uncheck();
    await page.getByRole('button', { name: '許可する' }).click();

    await expect(page.getByTestId('consent').getByRole('alert')).toHaveText('許可する権限を 1 つ以上選んでください。');
    expect(decisions).toEqual([]);
  });

  test('期限切れ・使用済みのリクエストはサーバーの説明を表示する', async ({ page }) => {
    await mockOAuth(page, { requestStatus: 404 });
    await page.goto(appPath(`/oauth/consent?req=${REQUEST_ID}`));
    await expect(page.getByTestId('consent-error')).toContainText('expired or has already been used');
  });

  test('MCP が提供されていない環境(開発モード)では利用できない旨を表示する', async ({ page }) => {
    await page.goto(appPath(`/oauth/consent?req=${REQUEST_ID}`));
    await expect(page.getByTestId('consent-error')).toContainText('外部アプリとの接続(OAuth)を利用できません');
  });
});
