import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes } from 'crypto';

/** 認証テーブルに保存するアクセストークンのレコード(平文のトークンは保存しない) */
export interface TokenRecord {
  PK: string;
  SK: 'META';
  GSI1PK: string;
  GSI1SK: string;
  tokenId: string;
  kind: 'pat';
  userId: string;
  name: string;
  secretHash: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
  /** DynamoDB の TTL(epoch 秒)。監査のため期限の 30 日後まで残す */
  ttl: number;
}

/** 認証テーブルへのアクセス(テストで差し替えられるようにする) */
export interface TokenStore {
  getToken(tokenId: string): Promise<TokenRecord | null>;
  listTokens(userId: string): Promise<TokenRecord[]>;
  putToken(record: TokenRecord): Promise<void>;
  /** 自分のトークンなら revokedAt を設定して true。存在しない・他人のトークンなら false */
  revokeToken(userId: string, tokenId: string, now: Date): Promise<boolean>;
}

export interface TokensDeps {
  store: TokenStore;
  environment: string;
  now?: () => Date;
  random?: (size: number) => Buffer;
}

// PAT に付与できるスコープ。削除は PAT に許可しない(設計書 8 章の決定事項)
export const PAT_SCOPES = ['notes:read', 'notes:write'] as const;
export const MAX_EXPIRES_IN_DAYS = 90;
export const DEFAULT_EXPIRES_IN_DAYS = 30;
export const MAX_ACTIVE_TOKENS = 20;
const MAX_NAME_LENGTH = 100;
const RECORD_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TOKEN_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://ougotti.github.io',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return { statusCode, headers: CORS_HEADERS, body: body === undefined ? '' : JSON.stringify(body) };
}

function error(statusCode: number, code: string, message: string): APIGatewayProxyResult {
  return json(statusCode, { error: code, message });
}

/** 10 バイト(80 ビット)をちょうど 16 文字の Crockford base32 にする */
export function encodeTokenId(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD_BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

export function hashSecret(secret: string): string {
  return `sha256:${createHash('sha256').update(secret).digest('hex')}`;
}

type TokenStatus = 'active' | 'expired' | 'revoked';

function statusOf(record: TokenRecord, now: Date): TokenStatus {
  if (record.revokedAt) return 'revoked';
  return new Date(record.expiresAt).getTime() > now.getTime() ? 'active' : 'expired';
}

/** API で返す形。secretHash やキーは含めない */
function toView(record: TokenRecord, now: Date) {
  return {
    tokenId: record.tokenId,
    kind: record.kind,
    name: record.name,
    scopes: record.scopes,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt ?? null,
    revokedAt: record.revokedAt ?? null,
    status: statusOf(record, now),
  };
}

type CreateInput = { name: string; scopes: string[]; expiresInDays: number };

export function validateCreateInput(body: unknown): { ok: true; value: CreateInput } | { ok: false; message: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'リクエストボディは JSON オブジェクトである必要があります' };
  }
  const input = body as Record<string, unknown>;

  if (typeof input.name !== 'string') {
    return { ok: false, message: 'name は文字列である必要があります' };
  }
  // 制御文字・ゼロ幅文字を除き、表示名と同じ基準で正規化する
  const name = input.name
    .normalize('NFC')
    .replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g, '')
    .trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `name は 1〜${MAX_NAME_LENGTH} 文字で指定してください` };
  }

  if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
    return { ok: false, message: 'scopes を 1 つ以上指定してください' };
  }
  const scopes: string[] = [];
  for (const scope of input.scopes) {
    if (scope === 'notes:delete') {
      return { ok: false, message: 'PAT には notes:delete を付与できません' };
    }
    if (typeof scope !== 'string' || !(PAT_SCOPES as readonly string[]).includes(scope)) {
      return { ok: false, message: `scopes に指定できるのは ${PAT_SCOPES.join(', ')} です` };
    }
    if (!scopes.includes(scope)) scopes.push(scope);
  }

  const expiresInDays = input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
  if (!Number.isInteger(expiresInDays) || (expiresInDays as number) < 1 || (expiresInDays as number) > MAX_EXPIRES_IN_DAYS) {
    return { ok: false, message: `expiresInDays は 1〜${MAX_EXPIRES_IN_DAYS} の整数で指定してください` };
  }

  return { ok: true, value: { name, scopes, expiresInDays: expiresInDays as number } };
}

export function createHandler(deps: TokensDeps) {
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? randomBytes;

  async function createToken(userId: string, rawBody: string | null): Promise<APIGatewayProxyResult> {
    let body: unknown;
    try {
      body = JSON.parse(rawBody || '{}');
    } catch {
      return error(400, 'invalid_request', 'リクエストボディが JSON として読めません');
    }
    const validation = validateCreateInput(body);
    if (!validation.ok) {
      return error(400, 'invalid_request', validation.message);
    }

    const current = now();
    const existing = await deps.store.listTokens(userId);
    if (existing.filter((record) => statusOf(record, current) === 'active').length >= MAX_ACTIVE_TOKENS) {
      return error(409, 'too_many_tokens', `有効なトークンは ${MAX_ACTIVE_TOKENS} 個までです。不要なトークンを失効してください`);
    }

    const tokenId = encodeTokenId(random(10));
    const secret = random(32).toString('base64url');
    const expiresAt = new Date(current.getTime() + validation.value.expiresInDays * DAY_MS);
    const record: TokenRecord = {
      PK: `TOKEN#${tokenId}`,
      SK: 'META',
      GSI1PK: `USER#${userId}`,
      GSI1SK: `TOKEN#${current.toISOString()}`,
      tokenId,
      kind: 'pat',
      userId,
      name: validation.value.name,
      secretHash: hashSecret(secret),
      scopes: validation.value.scopes,
      createdAt: current.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ttl: Math.floor((expiresAt.getTime() + RECORD_RETENTION_DAYS * DAY_MS) / 1000),
    };
    await deps.store.putToken(record);

    // 平文のトークンを返すのはこのレスポンスだけ
    return json(201, {
      token: `snb_${deps.environment}_${tokenId}_${secret}`,
      tokenInfo: toView(record, current),
    });
  }

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const authorizer = event.requestContext.authorizer;
      const userId = authorizer?.userId;
      if (!userId) {
        return error(401, 'unauthorized', '認証が必要です');
      }
      const route = `${event.httpMethod} ${event.resource}`;

      // 呼び出しに使っているトークン自身の情報。MCP サーバーが自分の権限を確認するために使う
      if (route === 'GET /tokens/self') {
        if (authorizer?.authType !== 'pat' || !authorizer?.tokenId) {
          return error(400, 'not_a_token', 'このエンドポイントはアクセストークンで呼び出してください');
        }
        const record = await deps.store.getToken(authorizer.tokenId);
        if (!record || record.userId !== userId) {
          return error(404, 'not_found', 'トークンが見つかりません');
        }
        return json(200, { token: toView(record, now()) });
      }

      // それ以外のトークン管理はブラウザのログイン(Cognito)のみ。
      // PAT で新しいトークンを発行して権限を広げられないようにする
      if (authorizer?.authType !== 'cognito') {
        return error(403, 'forbidden', 'トークンの管理はブラウザからログインして行ってください');
      }

      switch (route) {
        case 'GET /tokens': {
          const current = now();
          const records = await deps.store.listTokens(userId);
          return json(200, { tokens: records.map((record) => toView(record, current)) });
        }
        case 'POST /tokens':
          return await createToken(userId, event.body);
        case 'DELETE /tokens/{tokenId}': {
          const tokenId = event.pathParameters?.tokenId ?? '';
          if (!TOKEN_ID_PATTERN.test(tokenId)) {
            return error(400, 'invalid_request', 'tokenId の形式が正しくありません');
          }
          // 他人のトークンも「見つからない」として扱い、存在を漏らさない
          if (!(await deps.store.revokeToken(userId, tokenId, now()))) {
            return error(404, 'not_found', 'トークンが見つかりません');
          }
          return json(204, undefined);
        }
        default:
          return error(405, 'method_not_allowed', 'Method not allowed');
      }
    } catch (err) {
      console.error('Error:', err);
      return error(500, 'internal_error', 'Internal server error');
    }
  };
}

export function createDynamoTokenStore(tableName: string, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))): TokenStore {
  return {
    async getToken(tokenId) {
      const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { PK: `TOKEN#${tokenId}`, SK: 'META' },
      }));
      return (result.Item as TokenRecord | undefined) ?? null;
    },
    async listTokens(userId) {
      const records: TokenRecord[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const result = await client.send(new QueryCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
          ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':prefix': 'TOKEN#' },
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        }));
        records.push(...((result.Items ?? []) as TokenRecord[]));
        exclusiveStartKey = result.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return records;
    },
    async putToken(record) {
      await client.send(new PutCommand({
        TableName: tableName,
        Item: record,
        // tokenId の衝突で既存のトークンを上書きしない
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    },
    async revokeToken(userId, tokenId, now) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: `TOKEN#${tokenId}`, SK: 'META' },
          // 失効済みなら日時を変えない(何度呼んでも同じ結果になる)
          UpdateExpression: 'SET revokedAt = if_not_exists(revokedAt, :now)',
          ConditionExpression: 'attribute_exists(PK) AND userId = :me',
          ExpressionAttributeValues: { ':now': now.toISOString(), ':me': userId },
        }));
        return true;
      } catch (err) {
        if ((err as Error).name === 'ConditionalCheckFailedException') return false;
        throw err;
      }
    },
  };
}

export const handler = createHandler({
  store: createDynamoTokenStore(process.env.AUTH_TABLE_NAME!),
  environment: process.env.ENVIRONMENT!,
});
