import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

// handler の生成時に CognitoJwtVerifier.create が走るため、import 前に設定する
process.env.USER_POOL_ID = 'ap-northeast-1_TestPool';
process.env.USER_POOL_CLIENT_ID = 'test-client-id';
process.env.AUTH_TABLE_NAME = 'test-auth-table';
process.env.ENVIRONMENT = 'prod';

import {
  apiWildcardArn,
  createHandler,
  extractToken,
  hashSecret,
  parsePat,
  StoredToken,
  TokenStore,
  TokenVerifier,
} from '../authorizer/index';

const METHOD_ARN = 'arn:aws:execute-api:ap-northeast-1:123456789012:abc123/prod/GET/notes/note-1';
const NOW = new Date('2026-09-28T00:00:00.000Z');

// 秘密部分に "_" を含むケースでも分解できることを確かめる
const TOKEN_ID = 'ABCDEFGHJKMNPQRS';
const SECRET = `${'x'.repeat(40)}_-Z`;
const PAT = `snb_prod_${TOKEN_ID}_${SECRET}`;

function makeEvent(headers: Record<string, string> | null): APIGatewayRequestAuthorizerEvent {
  return {
    type: 'REQUEST',
    methodArn: METHOD_ARN,
    headers,
  } as unknown as APIGatewayRequestAuthorizerEvent;
}

function storedToken(overrides: Partial<StoredToken> = {}): StoredToken {
  return {
    tokenId: TOKEN_ID,
    userId: 'user-sub-123',
    secretHash: hashSecret(SECRET),
    scopes: ['notes:read', 'notes:write'],
    expiresAt: '2026-10-28T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function makeStore(token: StoredToken | null): TokenStore & { getToken: jest.Mock; touchLastUsed: jest.Mock } {
  return {
    getToken: jest.fn(async () => token),
    touchLastUsed: jest.fn(async () => undefined),
  };
}

const validVerifier: TokenVerifier = {
  verify: jest.fn(async (token: string) => {
    if (token !== 'valid-token') throw Object.assign(new Error('invalid'), { name: 'JwtInvalidSignatureError' });
    return { sub: 'user-sub-123' };
  }),
};

function makeHandler(store: TokenStore = makeStore(null)) {
  return createHandler({ jwtVerifier: validVerifier, tokenStore: store, environment: 'prod', now: () => NOW });
}

const ALLOW_ALL = [
  {
    Action: 'execute-api:Invoke',
    Effect: 'Allow',
    Resource: 'arn:aws:execute-api:ap-northeast-1:123456789012:abc123/prod/*',
  },
];

describe('extractToken', () => {
  it('Bearer 接頭辞付きのトークンを取り出す', () => {
    expect(extractToken({ Authorization: 'Bearer abc.def.ghi' })).toBe('abc.def.ghi');
  });

  it('接頭辞なしのトークンも受け付ける', () => {
    expect(extractToken({ Authorization: 'abc.def.ghi' })).toBe('abc.def.ghi');
  });

  it('ヘッダー名の大文字小文字を区別しない', () => {
    expect(extractToken({ authorization: 'bearer abc' })).toBe('abc');
  });

  it('ヘッダーがない・空・Bearer だけの場合は null', () => {
    expect(extractToken(null)).toBeNull();
    expect(extractToken({})).toBeNull();
    expect(extractToken({ Authorization: '' })).toBeNull();
    expect(extractToken({ Authorization: 'Bearer ' })).toBeNull();
  });
});

describe('apiWildcardArn', () => {
  it('同じ API・ステージの全メソッドを表す ARN にする', () => {
    expect(apiWildcardArn(METHOD_ARN)).toBe('arn:aws:execute-api:ap-northeast-1:123456789012:abc123/prod/*');
  });
});

describe('parsePat', () => {
  it('env・tokenId・secret に分解する(secret に "_" を含んでもよい)', () => {
    expect(parsePat(PAT)).toEqual({ env: 'prod', tokenId: TOKEN_ID, secret: SECRET });
  });

  it('形式が違うものは null', () => {
    expect(parsePat('snb_prod_short_secret')).toBeNull();
    // Crockford base32 に含まれない文字(I・L・O・U)
    expect(parsePat(`snb_prod_ABCDEFGHIJKLMNOP_${SECRET}`)).toBeNull();
    expect(parsePat(`snb_prod_${TOKEN_ID}_${SECRET}x`)).toBeNull();
    expect(parsePat(`xsnb_prod_${TOKEN_ID}_${SECRET}`)).toBeNull();
  });
});

describe('handler (Cognito JWT)', () => {
  const handler = makeHandler();

  it('有効なトークンでは API 全体を Allow し、context に userId と全スコープを渡す', async () => {
    const result = await handler(makeEvent({ Authorization: 'Bearer valid-token' }));

    expect(result.principalId).toBe('user-sub-123');
    expect(result.policyDocument.Statement).toEqual(ALLOW_ALL);
    expect(result.context).toEqual({
      userId: 'user-sub-123',
      authType: 'cognito',
      scopes: 'notes:read notes:write notes:delete',
    });
  });

  it('検証に失敗したトークンは Unauthorized(401)', async () => {
    await expect(handler(makeEvent({ Authorization: 'Bearer forged-token' }))).rejects.toThrow('Unauthorized');
  });

  it('トークンがなければ検証せずに Unauthorized(401)', async () => {
    (validVerifier.verify as jest.Mock).mockClear();
    await expect(handler(makeEvent({}))).rejects.toThrow('Unauthorized');
    expect(validVerifier.verify).not.toHaveBeenCalled();
  });
});

describe('handler (PAT)', () => {
  it('有効な PAT では API 全体を Allow し、context に保存されたスコープを渡す', async () => {
    const store = makeStore(storedToken());
    (validVerifier.verify as jest.Mock).mockClear();

    const result = await makeHandler(store)(makeEvent({ Authorization: `Bearer ${PAT}` }));

    expect(store.getToken).toHaveBeenCalledWith(TOKEN_ID);
    expect(validVerifier.verify).not.toHaveBeenCalled();
    expect(result.principalId).toBe('user-sub-123');
    expect(result.policyDocument.Statement).toEqual(ALLOW_ALL);
    expect(result.context).toEqual({
      userId: 'user-sub-123',
      authType: 'pat',
      tokenId: TOKEN_ID,
      scopes: 'notes:read notes:write',
    });
    expect(store.touchLastUsed).toHaveBeenCalledWith(TOKEN_ID, NOW);
  });

  it('保存データに未知のスコープや notes:delete があっても context には載せない', async () => {
    const store = makeStore(storedToken({ scopes: ['notes:read', 'notes:delete', 'admin:all'] }));
    const result = await makeHandler(store)(makeEvent({ Authorization: `Bearer ${PAT}` }));
    expect(result.context?.scopes).toBe('notes:read');
  });

  it('保存データの scopes が配列でなければスコープなしとして扱う', async () => {
    const store = makeStore(storedToken({ scopes: 'notes:read notes:delete' as unknown as string[] }));
    const result = await makeHandler(store)(makeEvent({ Authorization: `Bearer ${PAT}` }));
    expect(result.context?.scopes).toBe('');
  });

  it.each([
    ['存在しない', null],
    ['失効済み', storedToken({ revokedAt: '2026-09-01T00:00:00.000Z' })],
    ['期限切れ', storedToken({ expiresAt: '2026-09-27T23:59:59.999Z' })],
    ['期限がちょうど今', storedToken({ expiresAt: NOW.toISOString() })],
    ['期限が不正な値', storedToken({ expiresAt: 'not-a-date' })],
    ['秘密部分が一致しない', storedToken({ secretHash: hashSecret('y'.repeat(43)) })],
  ])('%s PAT は Unauthorized(401)', async (_label, token) => {
    const store = makeStore(token);
    await expect(makeHandler(store)(makeEvent({ Authorization: `Bearer ${PAT}` }))).rejects.toThrow('Unauthorized');
    expect(store.touchLastUsed).not.toHaveBeenCalled();
  });

  it('別環境の PAT は DynamoDB を引かずに Unauthorized(401)', async () => {
    const store = makeStore(storedToken());
    await expect(
      makeHandler(store)(makeEvent({ Authorization: `Bearer snb_dev_${TOKEN_ID}_${SECRET}` }))
    ).rejects.toThrow('Unauthorized');
    expect(store.getToken).not.toHaveBeenCalled();
  });

  it('形式が壊れた snb_ トークンは Cognito 検証に回さず Unauthorized(401)', async () => {
    const store = makeStore(storedToken());
    (validVerifier.verify as jest.Mock).mockClear();
    await expect(makeHandler(store)(makeEvent({ Authorization: 'Bearer snb_garbage' }))).rejects.toThrow('Unauthorized');
    expect(store.getToken).not.toHaveBeenCalled();
    expect(validVerifier.verify).not.toHaveBeenCalled();
  });

  it('lastUsedAt の更新に失敗しても認証は通す', async () => {
    const store = makeStore(storedToken());
    store.touchLastUsed.mockRejectedValueOnce(Object.assign(new Error('throttled'), { name: 'ThrottlingException' }));
    const result = await makeHandler(store)(makeEvent({ Authorization: `Bearer ${PAT}` }));
    expect(result.context?.authType).toBe('pat');
  });
});
