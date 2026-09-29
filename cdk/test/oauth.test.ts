import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createHash } from 'crypto';

// 発行したアクセストークンをオーソライザー側の関数で検証するため、オーソライザーの import 前の設定も行う
process.env.USER_POOL_ID = 'ap-northeast-1_TestPool';
process.env.USER_POOL_CLIENT_ID = 'test-client-id';
process.env.AUTH_TABLE_NAME = 'test-auth-table';
process.env.ENVIRONMENT = 'prod';

import {
  AccessTokenRecord,
  ACCESS_TOKEN_TTL_SECONDS,
  AuthRequestRecord,
  ClientRecord,
  CodeRecord,
  ConnectionRecord,
  createHandler,
  isAllowedRedirectUri,
  OAuthStore,
  pkceMatches,
  RefreshTokenRecord,
} from '../oauth/index';
import { createHandler as createAuthorizer, StoredToken } from '../authorizer/index';

const ISSUER = 'https://mcp.notes.test';
const MCP_URL = `${ISSUER}/mcp`;
const CONSENT_URL = 'https://ougotti.github.io/simplenotebook/oauth/consent';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(43) + '-._~abc';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const COGNITO = { userId: 'user-1', authType: 'cognito' };

type AnyRecord = { PK: string; revokedAt?: string; usedAt?: string; GSI2PK?: string } & Record<string, unknown>;

/** DynamoDB の条件付き操作と同じ振る舞いをするインメモリ実装 */
function memoryStore() {
  const items = new Map<string, AnyRecord>();
  const get = <T>(pk: string) => (items.get(pk) as T | undefined) ?? null;
  const put = async (record: object) => {
    const r = record as AnyRecord;
    if (items.has(r.PK)) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
    items.set(r.PK, { ...r });
  };
  const consume = async <T>(pk: string) => {
    const item = items.get(pk);
    items.delete(pk);
    return (item as T | undefined) ?? null;
  };
  const store: OAuthStore = {
    getClient: async id => get<ClientRecord>(`CLIENT#${id}`),
    putClient: put,
    touchClient: async (id, now, ttl) => {
      const item = items.get(`CLIENT#${id}`);
      if (item) Object.assign(item, { lastUsedAt: now.toISOString(), ttl });
    },
    putAuthRequest: put,
    getAuthRequest: async id => get<AuthRequestRecord>(`AUTHREQ#${id}`),
    consumeAuthRequest: id => consume<AuthRequestRecord>(`AUTHREQ#${id}`),
    putCode: put,
    consumeCode: hash => consume<CodeRecord>(`CODE#${hash}`),
    putAccessToken: put,
    putRefreshToken: put,
    getRefreshToken: async id => get<RefreshTokenRecord>(`REFRESH#${id}`),
    markRefreshTokenUsed: async (id, now) => {
      const item = items.get(`REFRESH#${id}`);
      if (!item || item.usedAt) return false;
      item.usedAt = now.toISOString();
      return true;
    },
    putConnection: put,
    getConnection: async id => get<ConnectionRecord>(`CONN#${id}`),
    touchConnection: async (id, now, expiresAt, ttl) => {
      const item = items.get(`CONN#${id}`);
      if (item) Object.assign(item, { lastUsedAt: now.toISOString(), expiresAt, ttl });
    },
    revokeFamily: async (familyId, now) => {
      for (const item of items.values()) {
        if (item.GSI2PK === `FAMILY#${familyId}`) item.revokedAt ??= now.toISOString();
      }
    },
  };
  return { store, items };
}

let clock = new Date('2026-09-29T00:00:00.000Z');
let counter = 0;
function fakeRandom(size: number): Buffer {
  counter += 1;
  return Buffer.alloc(size, counter);
}

function setup() {
  const memory = memoryStore();
  clock = new Date('2026-09-29T00:00:00.000Z');
  counter = 0;
  const handler = createHandler({
    store: memory.store,
    config: {
      environment: 'prod',
      issuer: ISSUER,
      mcpUrl: MCP_URL,
      consentUrl: CONSENT_URL,
      allowedOrigins: ['https://ougotti.github.io', 'http://localhost:3000'],
    },
    now: () => clock,
    random: fakeRandom,
  });
  // 発行したアクセストークンが実際にオーソライザーを通るかを確かめる
  const authorizer = createAuthorizer({
    jwtVerifier: { verify: async () => { throw new Error('not a jwt'); } },
    tokenStore: {
      getToken: async id => (memory.items.get(`TOKEN#${id}`) as unknown as StoredToken | undefined) ?? null,
      touchLastUsed: async () => undefined,
    },
    environment: 'prod',
    now: () => clock,
  });
  const authorize = (token: string) => authorizer({
    type: 'REQUEST',
    methodArn: 'arn:aws:execute-api:ap-northeast-1:123456789012:api/$default/POST/mcp',
    headers: { Authorization: `Bearer ${token}` },
  } as never);
  return { ...memory, handler, authorize };
}

interface EventOptions {
  query?: Record<string, string>;
  body?: string;
  contentType?: string;
  auth?: Record<string, string>;
  requestId?: string;
  origin?: string;
}

function event(routeKey: string, options: EventOptions = {}): APIGatewayProxyEventV2 {
  return {
    routeKey,
    rawPath: routeKey.split(' ')[1],
    queryStringParameters: options.query,
    pathParameters: options.requestId ? { requestId: options.requestId } : undefined,
    headers: {
      ...(options.contentType ? { 'content-type': options.contentType } : {}),
      ...(options.origin ? { origin: options.origin } : {}),
    },
    body: options.body,
    isBase64Encoded: false,
    requestContext: { authorizer: options.auth ? { lambda: options.auth } : undefined },
  } as unknown as APIGatewayProxyEventV2;
}

const body = (result: { body?: string }) => JSON.parse(result.body ?? '{}');
const form = (params: Record<string, string>) => new URLSearchParams(params).toString();

async function registerClient(handler: ReturnType<typeof setup>['handler'], redirectUris = [REDIRECT]) {
  const result = await handler(event('POST /oauth/register', {
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' }),
    contentType: 'application/json',
  }));
  expect(result.statusCode).toBe(201);
  return body(result).client_id as string;
}

function authorizeQuery(clientId: string, overrides: Record<string, string> = {}) {
  return {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
    scope: 'notes:read notes:write',
    resource: MCP_URL,
    ...overrides,
  };
}

/** register → authorize → approve までを行い、認可コードを返す */
async function obtainCode(env: ReturnType<typeof setup>, scopes?: string[]) {
  const clientId = await registerClient(env.handler);
  const authorized = await env.handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId) }));
  const requestId = new URL(authorized.headers!.Location as string).searchParams.get('req')!;
  const approved = await env.handler(event('POST /oauth/approve', {
    auth: COGNITO,
    body: JSON.stringify({ requestId, approve: true, ...(scopes ? { scopes } : {}) }),
  }));
  const redirectUrl = new URL(body(approved).redirectUrl);
  return { clientId, code: redirectUrl.searchParams.get('code')!, redirectUrl };
}

async function exchange(env: ReturnType<typeof setup>, clientId: string, code: string, overrides: Record<string, string> = {}) {
  return env.handler(event('POST /oauth/token', {
    contentType: 'application/x-www-form-urlencoded',
    body: form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: VERIFIER, resource: MCP_URL, ...overrides }),
  }));
}

async function refresh(env: ReturnType<typeof setup>, clientId: string, refreshToken: string) {
  return env.handler(event('POST /oauth/token', {
    contentType: 'application/x-www-form-urlencoded',
    body: form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  }));
}

describe('ユーティリティ', () => {
  it('PKCE S256 を検証する', () => {
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
    expect(pkceMatches(VERIFIER + 'x', CHALLENGE)).toBe(false);
  });

  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:6274/oauth/callback', true],
    ['http://127.0.0.1:33418/callback', true],
    ['http://[::1]:8080/cb', true],
    ['http://example.com/callback', false],
    ['https://claude.ai/cb#fragment', false],
    ['https://user:pass@claude.ai/cb', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('リダイレクト先 %s は %s', (uri, expected) => {
    expect(isAllowedRedirectUri(uri)).toBe(expected);
  });
});

describe('メタデータ', () => {
  it('保護リソースのメタデータ(RFC 9728)はルートとパス付きの両方で返す', async () => {
    const { handler } = setup();
    for (const route of ['GET /.well-known/oauth-protected-resource', 'GET /.well-known/oauth-protected-resource/mcp']) {
      expect(body(await handler(event(route)))).toEqual({
        resource: MCP_URL,
        authorization_servers: [ISSUER],
        scopes_supported: ['notes:read', 'notes:write'],
        bearer_methods_supported: ['header'],
        resource_name: 'Simplenotebook',
      });
    }
  });

  it('認可サーバーのメタデータ(RFC 8414)', async () => {
    const { handler } = setup();
    expect(body(await handler(event('GET /.well-known/oauth-authorization-server')))).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['notes:read', 'notes:write'],
    });
  });
});

describe('POST /oauth/register(DCR)', () => {
  it('公開クライアントを登録する', async () => {
    const { handler, items } = setup();
    const clientId = await registerClient(handler);
    expect(items.get(`CLIENT#${clientId}`)).toMatchObject({ clientName: 'Claude', redirectUris: [REDIRECT] });
  });

  it.each([
    ['redirect_uris がない', {}],
    ['https でも loopback でもない', { redirect_uris: ['http://evil.example.com/cb'] }],
    ['機密クライアント', { redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' }],
    ['未対応のグラント', { redirect_uris: [REDIRECT], grant_types: ['implicit'] }],
  ])('%s → 400', async (_label, metadata) => {
    const { handler } = setup();
    const result = await handler(event('POST /oauth/register', { body: JSON.stringify(metadata), contentType: 'application/json' }));
    expect(result.statusCode).toBe(400);
  });
});

describe('GET /oauth/authorize', () => {
  it('認可リクエストを保存して同意画面へ 302 する', async () => {
    const { handler, items } = setup();
    const clientId = await registerClient(handler);
    const result = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId) }));
    expect(result.statusCode).toBe(302);
    const location = new URL(result.headers!.Location as string);
    expect(`${location.origin}${location.pathname}`).toBe(CONSENT_URL);
    const requestId = location.searchParams.get('req')!;
    expect(items.get(`AUTHREQ#${requestId}`)).toMatchObject({ clientId, redirectUri: REDIRECT, scopes: ['notes:read', 'notes:write'], state: 'xyz' });
  });

  it('クライアントやリダイレクト先が不正ならリダイレクトせずに 400(オープンリダイレクト防止)', async () => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const unknownClient = await handler(event('GET /oauth/authorize', { query: authorizeQuery('mcp_unknown') }));
    expect(unknownClient.statusCode).toBe(400);
    const wrongRedirect = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId, { redirect_uri: 'https://evil.example.com/cb' }) }));
    expect(wrongRedirect.statusCode).toBe(400);
    expect(wrongRedirect.headers?.Location).toBeUndefined();
  });

  it.each([
    ['PKCE なし', { code_challenge: '' }, 'invalid_request'],
    ['plain の PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
    ['未知のスコープ', { scope: 'notes:read notes:delete' }, 'invalid_scope'],
    ['別のリソース', { resource: 'https://other.example.com/mcp' }, 'invalid_target'],
    ['code 以外の response_type', { response_type: 'token' }, 'unsupported_response_type'],
  ])('%s → エラーをリダイレクト先に返す', async (_label, overrides, error) => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const result = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId, overrides) }));
    expect(result.statusCode).toBe(302);
    const location = new URL(result.headers!.Location as string);
    expect(`${location.origin}${location.pathname}`).toBe(REDIRECT);
    expect(location.searchParams.get('error')).toBe(error);
    expect(location.searchParams.get('state')).toBe('xyz');
  });
});

describe('同意画面の API', () => {
  it('ログイン済みならリクエストの内容(クライアント名・リダイレクト先のホスト)を取得できる', async () => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const authorized = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId, { scope: 'notes:read' }) }));
    const requestId = new URL(authorized.headers!.Location as string).searchParams.get('req')!;

    const result = await handler(event('GET /oauth/requests/{requestId}', { auth: COGNITO, requestId, origin: 'https://ougotti.github.io' }));
    expect(body(result)).toMatchObject({ clientName: 'Claude', redirectHost: 'claude.ai', scopes: ['notes:read'] });
    expect(result.headers).toMatchObject({ 'Access-Control-Allow-Origin': 'https://ougotti.github.io' });
  });

  it('アクセストークン(PAT / OAuth)では同意できない', async () => {
    const { handler } = setup();
    for (const authType of ['pat', 'oauth']) {
      const result = await handler(event('POST /oauth/approve', {
        auth: { userId: 'user-1', authType },
        body: JSON.stringify({ requestId: 'ABCDEFGHJKMNPQRS', approve: true }),
      }));
      expect(result.statusCode).toBe(403);
    }
  });

  it('拒否すると access_denied をリダイレクト先に返し、同じリクエストはもう使えない', async () => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const authorized = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId) }));
    const requestId = new URL(authorized.headers!.Location as string).searchParams.get('req')!;

    const denied = await handler(event('POST /oauth/approve', { auth: COGNITO, body: JSON.stringify({ requestId, approve: false }) }));
    const redirectUrl = new URL(body(denied).redirectUrl);
    expect(redirectUrl.searchParams.get('error')).toBe('access_denied');
    expect(redirectUrl.searchParams.get('state')).toBe('xyz');

    const again = await handler(event('POST /oauth/approve', { auth: COGNITO, body: JSON.stringify({ requestId, approve: true }) }));
    expect(again.statusCode).toBe(404);
  });

  it('要求されていないスコープは付けられない', async () => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const authorized = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId, { scope: 'notes:read' }) }));
    const requestId = new URL(authorized.headers!.Location as string).searchParams.get('req')!;
    const result = await handler(event('POST /oauth/approve', { auth: COGNITO, body: JSON.stringify({ requestId, approve: true, scopes: ['notes:write'] }) }));
    expect(result.statusCode).toBe(400);
  });

  it('10 分を過ぎた認可リクエストは使えない', async () => {
    const { handler } = setup();
    const clientId = await registerClient(handler);
    const authorized = await handler(event('GET /oauth/authorize', { query: authorizeQuery(clientId) }));
    const requestId = new URL(authorized.headers!.Location as string).searchParams.get('req')!;
    clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1);
    expect((await handler(event('GET /oauth/requests/{requestId}', { auth: COGNITO, requestId }))).statusCode).toBe(404);
  });
});

describe('POST /oauth/token', () => {
  it('認可コードをトークンに交換でき、アクセストークンはオーソライザーを通る(MCP 専用の authType: oauth)', async () => {
    const env = setup();
    const { clientId, code, redirectUrl } = await obtainCode(env, ['notes:read']);
    expect(redirectUrl.searchParams.get('state')).toBe('xyz');
    expect(redirectUrl.searchParams.get('iss')).toBe(ISSUER);

    const result = await exchange(env, clientId, code);
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    const tokens = body(result);
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_SECONDS, scope: 'notes:read' });
    expect(tokens.access_token).toMatch(/^snb_prod_[0-9A-HJKMNP-TV-Z]{16}_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^snbr_prod_/);

    const authorized = await env.authorize(tokens.access_token);
    expect(authorized.context).toMatchObject({ userId: 'user-1', authType: 'oauth', scopes: 'notes:read', tokenName: 'Claude' });

    // 設定画面の一覧に出す「接続」が作られる
    const connection = [...env.items.values()].find(item => item.PK.startsWith('CONN#'))!;
    expect(connection).toMatchObject({ kind: 'oauth', name: 'Claude', userId: 'user-1', GSI1PK: 'USER#user-1' });
    // 平文は保存しない
    expect(JSON.stringify([...env.items.values()])).not.toContain(tokens.access_token.split('_').pop());
  });

  it('認可コードは 1 回しか使えない', async () => {
    const env = setup();
    const { clientId, code } = await obtainCode(env);
    expect((await exchange(env, clientId, code)).statusCode).toBe(200);
    expect(body(await exchange(env, clientId, code)).error).toBe('invalid_grant');
  });

  it.each([
    ['code_verifier が違う', { code_verifier: 'w'.repeat(43) }],
    ['client_id が違う', { client_id: 'mcp_other' }],
    ['redirect_uri が違う', { redirect_uri: 'https://claude.ai/other' }],
  ])('%s → invalid_grant', async (_label, overrides) => {
    const env = setup();
    const { clientId, code } = await obtainCode(env);
    const result = await exchange(env, clientId, code, overrides);
    expect(result.statusCode).toBe(400);
    expect(body(result).error).toBe('invalid_grant');
  });

  it('10 分を過ぎた認可コードは使えない', async () => {
    const env = setup();
    const { clientId, code } = await obtainCode(env);
    clock = new Date(clock.getTime() + 10 * 60 * 1000 + 1);
    expect(body(await exchange(env, clientId, code)).error).toBe('invalid_grant');
  });

  it('リフレッシュすると新しい組を返し、古いリフレッシュトークンの再利用を検知したら系列ごと失効させる', async () => {
    const env = setup();
    const { clientId, code } = await obtainCode(env);
    const first = body(await exchange(env, clientId, code));

    clock = new Date(clock.getTime() + 2 * 60 * 60 * 1000);
    const second = body(await refresh(env, clientId, first.refresh_token));
    expect(second.access_token).toBeDefined();
    expect(second.refresh_token).not.toBe(first.refresh_token);
    // 1 時間を過ぎた最初のアクセストークンは期限切れ、新しいものは通る
    await expect(env.authorize(first.access_token)).rejects.toThrow('Unauthorized');
    await expect(env.authorize(second.access_token)).resolves.toBeDefined();

    // 使用済みのリフレッシュトークンが再び使われた = 漏洩とみなす
    const reuse = await refresh(env, clientId, first.refresh_token);
    expect(body(reuse).error).toBe('invalid_grant');
    // 系列のトークンはすべて使えなくなる
    await expect(env.authorize(second.access_token)).rejects.toThrow('Unauthorized');
    expect(body(await refresh(env, clientId, second.refresh_token)).error).toBe('invalid_grant');
    const connection = [...env.items.values()].find(item => item.PK.startsWith('CONN#'))!;
    expect(connection.revokedAt).toBeDefined();
  });

  it('接続が失効していればリフレッシュできない', async () => {
    const env = setup();
    const { clientId, code } = await obtainCode(env);
    const tokens = body(await exchange(env, clientId, code));
    const connection = [...env.items.values()].find(item => item.PK.startsWith('CONN#'))!;
    connection.revokedAt = clock.toISOString();
    expect(body(await refresh(env, clientId, tokens.refresh_token)).error).toBe('invalid_grant');
  });

  it('JSON のリクエストも受け付け、未対応の grant_type は unsupported_grant_type', async () => {
    const env = setup();
    const result = await env.handler(event('POST /oauth/token', {
      contentType: 'application/json',
      body: JSON.stringify({ grant_type: 'client_credentials' }),
    }));
    expect(body(result).error).toBe('unsupported_grant_type');
  });
});
