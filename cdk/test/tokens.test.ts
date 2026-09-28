import { APIGatewayProxyEvent } from 'aws-lambda';

// 発行したトークンをオーソライザー側の関数で検証するため、オーソライザーの import 前の設定も行う
process.env.USER_POOL_ID = 'ap-northeast-1_TestPool';
process.env.USER_POOL_CLIENT_ID = 'test-client-id';
process.env.AUTH_TABLE_NAME = 'test-auth-table';
process.env.ENVIRONMENT = 'prod';

import {
  createHandler,
  encodeTokenId,
  hashSecret,
  MAX_ACTIVE_TOKENS,
  TokenRecord,
  TokenStore,
  validateCreateInput,
} from '../tokens/index';
import { hashSecret as authorizerHashSecret, parsePat } from '../authorizer/index';

const NOW = new Date('2026-09-28T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

type Auth = { userId?: string; authType?: string; tokenId?: string; scopes?: string };

const COGNITO: Auth = { userId: 'user-1', authType: 'cognito', scopes: 'notes:read notes:write notes:delete' };

function makeEvent(route: string, auth: Auth, options: { body?: unknown; tokenId?: string } = {}): APIGatewayProxyEvent {
  const [httpMethod, resource] = route.split(' ');
  return {
    httpMethod,
    resource,
    body: options.body === undefined ? null : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    pathParameters: options.tokenId ? { tokenId: options.tokenId } : null,
    requestContext: { authorizer: auth },
  } as unknown as APIGatewayProxyEvent;
}

/** テスト用のインメモリ実装。DynamoDB の条件付き書き込みと同じ振る舞いをする */
function memoryStore(initial: TokenRecord[] = []) {
  const records = new Map(initial.map((record) => [record.tokenId, { ...record }]));
  const store: TokenStore = {
    async getToken(tokenId) {
      return records.get(tokenId) ?? null;
    },
    async listTokens(userId) {
      return [...records.values()]
        .filter((record) => record.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async putToken(record) {
      if (records.has(record.tokenId)) throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      records.set(record.tokenId, { ...record });
    },
    async revokeToken(userId, tokenId, now) {
      const record = records.get(tokenId);
      if (!record || record.userId !== userId) return false;
      record.revokedAt ??= now.toISOString();
      return true;
    },
  };
  return { store, records };
}

function record(overrides: Partial<TokenRecord> = {}): TokenRecord {
  const tokenId = overrides.tokenId ?? 'ABCDEFGHJKMNPQRS';
  return {
    PK: `TOKEN#${tokenId}`,
    SK: 'META',
    GSI1PK: `USER#${overrides.userId ?? 'user-1'}`,
    GSI1SK: 'TOKEN#2026-09-01T00:00:00.000Z',
    tokenId,
    kind: 'pat',
    userId: 'user-1',
    name: 'Claude Code',
    secretHash: hashSecret('s'.repeat(43)),
    scopes: ['notes:read'],
    createdAt: '2026-09-01T00:00:00.000Z',
    expiresAt: '2026-11-01T00:00:00.000Z',
    ttl: 0,
    ...overrides,
  };
}

// 乱数を固定し、発行されるトークンを予測できるようにする
let counter = 0;
function fakeRandom(size: number): Buffer {
  counter += 1;
  return Buffer.alloc(size, counter);
}

function makeHandler(store: TokenStore) {
  counter = 0;
  return createHandler({ store, environment: 'prod', now: () => NOW, random: fakeRandom });
}

function parse(body: string) {
  return JSON.parse(body);
}

describe('encodeTokenId', () => {
  it('10 バイトを 16 文字の Crockford base32 にする', () => {
    expect(encodeTokenId(Buffer.alloc(10, 0))).toBe('0000000000000000');
    expect(encodeTokenId(Buffer.alloc(10, 0xff))).toBe('ZZZZZZZZZZZZZZZZ');
    expect(encodeTokenId(Buffer.from([0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10, 0x84, 0x21]))).toBe('1111111111111111');
  });
});

describe('validateCreateInput', () => {
  it('正しい入力を正規化する(scopes の重複除去・名前の trim・期限の既定値 30 日)', () => {
    expect(validateCreateInput({ name: '  Claude Code​ ', scopes: ['notes:read', 'notes:read', 'notes:write'] })).toEqual({
      ok: true,
      value: { name: 'Claude Code', scopes: ['notes:read', 'notes:write'], expiresInDays: 30 },
    });
  });

  it.each([
    ['オブジェクトでない', []],
    ['name がない', { scopes: ['notes:read'] }],
    ['name が空白だけ', { name: '   ', scopes: ['notes:read'] }],
    ['name が長すぎる', { name: 'a'.repeat(101), scopes: ['notes:read'] }],
    ['scopes が空', { name: 'x', scopes: [] }],
    ['未知のスコープ', { name: 'x', scopes: ['admin'] }],
    ['notes:delete を含む(PAT には付与できない)', { name: 'x', scopes: ['notes:read', 'notes:delete'] }],
    ['期限が 0 日', { name: 'x', scopes: ['notes:read'], expiresInDays: 0 }],
    ['期限が 90 日超', { name: 'x', scopes: ['notes:read'], expiresInDays: 91 }],
    ['期限が小数', { name: 'x', scopes: ['notes:read'], expiresInDays: 1.5 }],
    ['期限が文字列', { name: 'x', scopes: ['notes:read'], expiresInDays: '30' }],
  ])('%s → エラー', (_label, body) => {
    expect(validateCreateInput(body).ok).toBe(false);
  });

  it('notes:delete を指定したときは理由がわかるメッセージを返す', () => {
    expect(validateCreateInput({ name: 'x', scopes: ['notes:delete'] })).toEqual({
      ok: false,
      message: 'PAT には notes:delete を付与できません',
    });
  });
});

describe('POST /tokens', () => {
  it('平文トークンを 1 回だけ返し、保存するのはハッシュだけ', async () => {
    const { store, records } = memoryStore();
    const result = await makeHandler(store)(
      makeEvent('POST /tokens', COGNITO, { body: { name: 'Claude Code', scopes: ['notes:read'], expiresInDays: 90 } })
    );

    expect(result.statusCode).toBe(201);
    const body = parse(result.body);
    const parsed = parsePat(body.token);
    // オーソライザーが受け付ける形式・ハッシュで発行されていること
    expect(parsed).not.toBeNull();
    expect(parsed!.env).toBe('prod');
    expect(body.tokenInfo).toEqual({
      tokenId: parsed!.tokenId,
      kind: 'pat',
      name: 'Claude Code',
      scopes: ['notes:read'],
      createdAt: NOW.toISOString(),
      expiresAt: new Date(NOW.getTime() + 90 * DAY_MS).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      status: 'active',
    });
    expect(body.tokenInfo).not.toHaveProperty('secretHash');

    const saved = records.get(parsed!.tokenId)!;
    expect(saved.secretHash).toBe(authorizerHashSecret(parsed!.secret));
    expect(JSON.stringify(saved)).not.toContain(parsed!.secret);
    expect(saved).toMatchObject({
      PK: `TOKEN#${parsed!.tokenId}`,
      SK: 'META',
      GSI1PK: 'USER#user-1',
      GSI1SK: `TOKEN#${NOW.toISOString()}`,
      userId: 'user-1',
      // 期限の 30 日後まで監査用に残す
      ttl: Math.floor((NOW.getTime() + 120 * DAY_MS) / 1000),
    });
  });

  it('入力が不正なら 400', async () => {
    const { store } = memoryStore();
    const handler = makeHandler(store);
    expect((await handler(makeEvent('POST /tokens', COGNITO, { body: '{broken' }))).statusCode).toBe(400);
    const result = await handler(makeEvent('POST /tokens', COGNITO, { body: { name: 'x', scopes: ['notes:delete'] } }));
    expect(result.statusCode).toBe(400);
    expect(parse(result.body).message).toBe('PAT には notes:delete を付与できません');
  });

  it(`有効なトークンが ${MAX_ACTIVE_TOKENS} 個あると 409。失効済み・期限切れは数えない`, async () => {
    const active = Array.from({ length: MAX_ACTIVE_TOKENS }, (_, i) =>
      record({ tokenId: `A${String(i).padStart(15, '0')}` })
    );
    const { store } = memoryStore([
      ...active.slice(1),
      record({ tokenId: 'B000000000000000', revokedAt: '2026-09-02T00:00:00.000Z' }),
      record({ tokenId: 'C000000000000000', expiresAt: '2026-09-02T00:00:00.000Z' }),
    ]);
    const handler = makeHandler(store);
    const body = { name: 'x', scopes: ['notes:read'] };

    expect((await handler(makeEvent('POST /tokens', COGNITO, { body }))).statusCode).toBe(201);
    expect((await handler(makeEvent('POST /tokens', COGNITO, { body }))).statusCode).toBe(409);
  });
});

describe('GET /tokens', () => {
  it('自分のトークンだけを状態付きで返す(秘密情報は含めない)', async () => {
    const { store } = memoryStore([
      record({ tokenId: 'A000000000000000' }),
      record({ tokenId: 'B000000000000000', revokedAt: '2026-09-02T00:00:00.000Z' }),
      record({ tokenId: 'C000000000000000', expiresAt: '2026-09-02T00:00:00.000Z' }),
      record({ tokenId: 'D000000000000000', userId: 'someone-else' }),
    ]);
    const result = await makeHandler(store)(makeEvent('GET /tokens', COGNITO));

    expect(result.statusCode).toBe(200);
    const { tokens } = parse(result.body);
    expect(tokens.map((t: { tokenId: string; status: string }) => [t.tokenId, t.status])).toEqual([
      ['A000000000000000', 'active'],
      ['B000000000000000', 'revoked'],
      ['C000000000000000', 'expired'],
    ]);
    expect(result.body).not.toContain('secretHash');
    expect(result.body).not.toContain('sha256:');
  });
});

describe('DELETE /tokens/{tokenId}', () => {
  it('自分のトークンを失効できる(2 回目も 204 で、失効日時は変わらない)', async () => {
    const { store, records } = memoryStore([record()]);
    const handler = makeHandler(store);

    expect((await handler(makeEvent('DELETE /tokens/{tokenId}', COGNITO, { tokenId: 'ABCDEFGHJKMNPQRS' }))).statusCode).toBe(204);
    expect(records.get('ABCDEFGHJKMNPQRS')!.revokedAt).toBe(NOW.toISOString());
    expect((await handler(makeEvent('DELETE /tokens/{tokenId}', COGNITO, { tokenId: 'ABCDEFGHJKMNPQRS' }))).statusCode).toBe(204);
    expect(records.get('ABCDEFGHJKMNPQRS')!.revokedAt).toBe(NOW.toISOString());
  });

  it('他人のトークン・存在しないトークンは 404(失効しない)', async () => {
    const { store, records } = memoryStore([record({ userId: 'someone-else' })]);
    const handler = makeHandler(store);

    expect((await handler(makeEvent('DELETE /tokens/{tokenId}', COGNITO, { tokenId: 'ABCDEFGHJKMNPQRS' }))).statusCode).toBe(404);
    expect(records.get('ABCDEFGHJKMNPQRS')!.revokedAt).toBeUndefined();
    expect((await handler(makeEvent('DELETE /tokens/{tokenId}', COGNITO, { tokenId: 'Z000000000000000' }))).statusCode).toBe(404);
  });

  it('tokenId の形式が不正なら 400', async () => {
    const { store } = memoryStore();
    const result = await makeHandler(store)(makeEvent('DELETE /tokens/{tokenId}', COGNITO, { tokenId: '../../etc' }));
    expect(result.statusCode).toBe(400);
  });
});

describe('PAT からの呼び出し', () => {
  const PAT_AUTH: Auth = { userId: 'user-1', authType: 'pat', tokenId: 'ABCDEFGHJKMNPQRS', scopes: 'notes:read notes:write' };

  it.each(['GET /tokens', 'POST /tokens', 'DELETE /tokens/{tokenId}'])('%s は 403(PAT で権限を広げられない)', async (route) => {
    const { store, records } = memoryStore([record()]);
    const result = await makeHandler(store)(
      makeEvent(route, PAT_AUTH, { body: { name: 'x', scopes: ['notes:read'] }, tokenId: 'ABCDEFGHJKMNPQRS' })
    );
    expect(result.statusCode).toBe(403);
    expect(records.size).toBe(1);
    expect(records.get('ABCDEFGHJKMNPQRS')!.revokedAt).toBeUndefined();
  });

  it('GET /tokens/self で自分自身の情報を取得できる', async () => {
    const { store } = memoryStore([record({ scopes: ['notes:read', 'notes:write'] })]);
    const result = await makeHandler(store)(makeEvent('GET /tokens/self', PAT_AUTH));

    expect(result.statusCode).toBe(200);
    expect(parse(result.body).token).toMatchObject({
      tokenId: 'ABCDEFGHJKMNPQRS',
      scopes: ['notes:read', 'notes:write'],
      status: 'active',
    });
  });

  it('GET /tokens/self はブラウザのログインでは 400', async () => {
    const { store } = memoryStore([record()]);
    expect((await makeHandler(store)(makeEvent('GET /tokens/self', COGNITO))).statusCode).toBe(400);
  });
});

it('認証情報がなければ 401', async () => {
  const { store } = memoryStore();
  expect((await makeHandler(store)(makeEvent('GET /tokens', {}))).statusCode).toBe(401);
});
