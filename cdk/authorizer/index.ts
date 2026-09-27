import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

/** 検証に必要な最小限のインターフェース(テストで差し替えられるようにする) */
export interface TokenVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

// ブラウザ(Cognito JWT)には全スコープを与え、現行の挙動を変えない
const COGNITO_SCOPES = 'notes:read notes:write notes:delete';

/** Authorization ヘッダーからトークンを取り出す。`Bearer ` 接頭辞の有無どちらも受け付ける */
export function extractToken(headers: APIGatewayRequestAuthorizerEvent['headers']): string | null {
  if (!headers) return null;
  // REQUEST 型オーソライザーのヘッダー名は送信時の大文字小文字のまま届く
  const key = Object.keys(headers).find((name) => name.toLowerCase() === 'authorization');
  const value = key ? headers[key] : undefined;
  if (!value) return null;
  // 先に trim すると "Bearer " が "Bearer" になり接頭辞として外れないため、接頭辞を先に除去する
  const token = value.replace(/^\s*Bearer(\s+|$)/i, '').trim();
  return token || null;
}

/**
 * methodArn(arn:aws:execute-api:region:account:apiId/stage/METHOD/path)から
 * 同じ API・ステージの全メソッドを表す ARN を作る。
 * オーソライザーの結果はトークン単位でキャッシュされ、他のメソッドにも使い回されるため、
 * 個別メソッドの ARN で Allow すると別メソッドへのアクセスが 403 になる。
 */
export function apiWildcardArn(methodArn: string): string {
  const [apiArn, stage] = methodArn.split('/');
  return `${apiArn}/${stage}/*`;
}

export function createHandler(verifier: TokenVerifier) {
  return async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
    const token = extractToken(event.headers);
    if (!token) {
      // API Gateway は 'Unauthorized' という例外メッセージを 401 として返す
      throw new Error('Unauthorized');
    }

    let sub: string;
    try {
      ({ sub } = await verifier.verify(token));
    } catch (error) {
      console.warn('Token verification failed:', (error as Error).name);
      throw new Error('Unauthorized');
    }

    return {
      principalId: sub,
      policyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Action: 'execute-api:Invoke',
            Effect: 'Allow',
            Resource: apiWildcardArn(event.methodArn),
          },
        ],
      },
      // context の値は文字列・数値・真偽値のみ(配列不可)
      context: {
        userId: sub,
        authType: 'cognito',
        scopes: COGNITO_SCOPES,
      },
    };
  };
}

// 現行の Cognito オーソライザーと同じく ID トークンを受け付ける。clientId も一致を確認する
export const handler = createHandler(
  CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID!,
    tokenUse: 'id',
    clientId: process.env.USER_POOL_CLIENT_ID!,
  })
);
