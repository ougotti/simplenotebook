import { APIGatewayAuthorizerResult, APIGatewayRequestAuthorizerEvent } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, timingSafeEqual } from 'crypto';

/** 検証に必要な最小限のインターフェース(テストで差し替えられるようにする) */
export interface TokenVerifier {
  verify(token: string): Promise<{ sub: string }>;
}

/** 認証テーブルに保存されたアクセストークン(PAT)のうち、検証に使う項目 */
export interface StoredToken {
  tokenId: string;
  userId: string;
  secretHash: string;
  scopes: string[];
  expiresAt: string;
  revokedAt?: string | null;
  /** 発行時に付けた名前。ノートの更新者(lastModifiedBy)の表示に使う */
  name?: string;
  /** 'pat'(設定画面で発行)か 'oauth'(コネクタの OAuth で発行)。旧データにはないので未指定は 'pat' */
  kind?: string;
}

/** 認証テーブルへのアクセス(テストで差し替えられるようにする) */
export interface TokenStore {
  getToken(tokenId: string): Promise<StoredToken | null>;
  /** lastUsedAt を更新する。1 時間以内に更新済みなら何もしない */
  touchLastUsed(tokenId: string, now: Date): Promise<void>;
}

export interface AuthorizerDeps {
  jwtVerifier: TokenVerifier;
  tokenStore: TokenStore;
  /** トークンに埋め込まれた env と一致しなければ拒否する(dev のトークンを prod で使わせない) */
  environment: string;
  now?: () => Date;
}

// ブラウザ(Cognito JWT)には全スコープを与え、現行の挙動を変えない
const COGNITO_SCOPES = 'notes:read notes:write notes:delete';
// PAT の context に載せてよいスコープ。notes:delete は PAT に許可しない(設計書 8 章 2)。
// 発行 API でも弾いているが、保存データが壊れていたり手で投入されたりしても権限が広がらないよう、ここでも絞る
const PAT_ALLOWED_SCOPES = new Set(['notes:read', 'notes:write']);

/**
 * PAT の形式: snb_<env>_<tokenId>_<secret>
 * - env は "_" を含まない / tokenId は 16 文字の Crockford base32 / secret は 32 バイトの base64url(43 文字。"_" を含み得る)
 * env と tokenId に "_" が入らないため、secret に "_" があっても一意に分解できる
 */
const PAT_PATTERN = /^snb_([a-z0-9-]+)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{43})$/;

export function parsePat(token: string): { env: string; tokenId: string; secret: string } | null {
  const match = PAT_PATTERN.exec(token);
  if (!match) return null;
  return { env: match[1], tokenId: match[2], secret: match[3] };
}

export function hashSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

function secretMatches(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret));
  const expected = Buffer.from(storedHash);
  // timingSafeEqual は長さが違うと例外を投げるため先に比べる(長さは形式で決まるので漏れても問題ない)
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

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
 * メソッドごとの権限(スコープ)は Notes Lambda 側で判定する。
 */
export function apiWildcardArn(methodArn: string): string {
  const [apiArn, stage] = methodArn.split('/');
  return `${apiArn}/${stage}/*`;
}

type AuthContext = { userId: string; authType: 'cognito' | 'pat' | 'oauth'; scopes: string; tokenId?: string; tokenName?: string };

function allow(methodArn: string, context: AuthContext): APIGatewayAuthorizerResult {
  return {
    principalId: context.userId,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: apiWildcardArn(methodArn),
        },
      ],
    },
    // context の値は文字列・数値・真偽値のみ(配列不可)
    context,
  };
}

async function verifyPat(token: string, deps: AuthorizerDeps, now: Date): Promise<AuthContext> {
  const parsed = parsePat(token);
  if (!parsed || parsed.env !== deps.environment) {
    throw new Error('Unauthorized');
  }

  const stored = await deps.tokenStore.getToken(parsed.tokenId);
  if (
    !stored ||
    stored.revokedAt ||
    !(new Date(stored.expiresAt).getTime() > now.getTime()) ||
    typeof stored.secretHash !== 'string' ||
    !secretMatches(parsed.secret, stored.secretHash)
  ) {
    throw new Error('Unauthorized');
  }

  try {
    await deps.tokenStore.touchLastUsed(parsed.tokenId, now);
  } catch (error) {
    // 最終使用日時は参考情報なので、更新に失敗しても認証は通す
    console.warn('Failed to update lastUsedAt:', (error as Error).name);
  }

  return {
    userId: stored.userId,
    // OAuth のトークンは MCP 専用。REST API 側で authType を見て拒否する
    authType: stored.kind === 'oauth' ? 'oauth' : 'pat',
    tokenId: stored.tokenId,
    tokenName: typeof stored.name === 'string' ? stored.name : '',
    scopes: (Array.isArray(stored.scopes) ? stored.scopes : []).filter((scope) => PAT_ALLOWED_SCOPES.has(scope)).join(' '),
  };
}

export function createHandler(deps: AuthorizerDeps) {
  return async (event: APIGatewayRequestAuthorizerEvent): Promise<APIGatewayAuthorizerResult> => {
    const token = extractToken(event.headers);
    if (!token) {
      // API Gateway は 'Unauthorized' という例外メッセージを 401 として返す
      throw new Error('Unauthorized');
    }

    if (token.startsWith('snb_')) {
      return allow(event.methodArn, await verifyPat(token, deps, (deps.now ?? (() => new Date()))()));
    }

    let sub: string;
    try {
      ({ sub } = await deps.jwtVerifier.verify(token));
    } catch (error) {
      console.warn('Token verification failed:', (error as Error).name);
      throw new Error('Unauthorized');
    }

    return allow(event.methodArn, { userId: sub, authType: 'cognito', scopes: COGNITO_SCOPES });
  };
}

const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

export function createDynamoTokenStore(tableName: string, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))): TokenStore {
  return {
    async getToken(tokenId) {
      const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TOKEN#${tokenId}`, SK: 'META' },
      }));
      return (result.Item as StoredToken | undefined) ?? null;
    },
    async touchLastUsed(tokenId, now) {
      try {
        // 書き込みを間引くため、前回の更新から 1 時間以上経っているときだけ更新する
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: `TOKEN#${tokenId}`, SK: 'META' },
          UpdateExpression: 'SET lastUsedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(lastUsedAt) OR lastUsedAt < :threshold)',
          ExpressionAttributeValues: {
            ':now': now.toISOString(),
            ':threshold': new Date(now.getTime() - LAST_USED_INTERVAL_MS).toISOString(),
          },
        }));
      } catch (error) {
        if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
      }
    },
  };
}

// 現行の Cognito オーソライザーと同じく ID トークンを受け付ける。clientId も一致を確認する
export const handler = createHandler({
  jwtVerifier: CognitoJwtVerifier.create({
    userPoolId: process.env.USER_POOL_ID!,
    tokenUse: 'id',
    clientId: process.env.USER_POOL_CLIENT_ID!,
  }),
  tokenStore: createDynamoTokenStore(process.env.AUTH_TABLE_NAME!),
  environment: process.env.ENVIRONMENT!,
});
