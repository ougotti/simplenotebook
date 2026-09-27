import { APIGatewayRequestAuthorizerEvent } from 'aws-lambda';

// handler の生成時に CognitoJwtVerifier.create が走るため、import 前に設定する
process.env.USER_POOL_ID = 'ap-northeast-1_TestPool';
process.env.USER_POOL_CLIENT_ID = 'test-client-id';

import { apiWildcardArn, createHandler, extractToken, TokenVerifier } from '../authorizer/index';

const METHOD_ARN = 'arn:aws:execute-api:ap-northeast-1:123456789012:abc123/prod/GET/notes/note-1';

function makeEvent(headers: Record<string, string> | null): APIGatewayRequestAuthorizerEvent {
  return {
    type: 'REQUEST',
    methodArn: METHOD_ARN,
    headers,
  } as unknown as APIGatewayRequestAuthorizerEvent;
}

const validVerifier: TokenVerifier = {
  verify: jest.fn(async (token: string) => {
    if (token !== 'valid-token') throw Object.assign(new Error('invalid'), { name: 'JwtInvalidSignatureError' });
    return { sub: 'user-sub-123' };
  }),
};

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

describe('handler', () => {
  const handler = createHandler(validVerifier);

  it('有効なトークンでは API 全体を Allow し、context に userId を渡す', async () => {
    const result = await handler(makeEvent({ Authorization: 'Bearer valid-token' }));

    expect(result.principalId).toBe('user-sub-123');
    expect(result.policyDocument.Statement).toEqual([
      {
        Action: 'execute-api:Invoke',
        Effect: 'Allow',
        Resource: 'arn:aws:execute-api:ap-northeast-1:123456789012:abc123/prod/*',
      },
    ]);
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
