import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { createS3Storage, ObjectStorage } from './storage';
import {
  Actor,
  createNotesService,
  NotesServiceOptions,
  parseNoteInput,
  validateNoteId,
  SearchOptions,
  ServiceError,
} from './notesService';

/**
 * REST API の HTTP 層。ルーティング・権限判定・リクエストの解釈・エラー形式だけを扱い、
 * ノート操作そのものは notesService に任せる。
 */

interface UserSettings {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

// API Gateway の CORS 設定(simplenotebook-stack.ts の defaultCorsPreflightOptions)と揃える
const ALLOWED_ORIGINS = ['https://ougotti.github.io', 'http://localhost:3000'];
const DEFAULT_ORIGIN = ALLOWED_ORIGINS[0];

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Requested-With,If-Match',
  // ブラウザから ETag を読めるようにする
  'Access-Control-Expose-Headers': 'ETag',
};

/** リクエストの Origin が許可済みならそれを、そうでなければ既定のオリジンを返す(任意のオリジンは許可しない) */
export function corsHeadersFor(requestHeaders: APIGatewayProxyEvent['headers'] | null | undefined): Record<string, string> {
  const origin = headerValue(requestHeaders ?? {}, 'Origin');
  return {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : DEFAULT_ORIGIN,
    // オリジンによって応答が変わるため、キャッシュがオリジンをまたいで使い回さないようにする
    Vary: 'Origin',
  };
}

type ErrorCode =
  | 'UNAUTHORIZED'
  | 'INSUFFICIENT_SCOPE'
  | 'NOTE_NOT_FOUND'
  | 'SETTINGS_NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'METHOD_NOT_ALLOWED'
  | 'INTERNAL_ERROR';

function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyResult {
  return {
    statusCode,
    // CORS ヘッダーはリクエストの Origin に依存するため、handler の最後でまとめて付ける
    headers,
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

/** エラー形式: 従来の error(説明)に機械判読用の code を足す */
function errorResponse(statusCode: number, code: ErrorCode, error: string): APIGatewayProxyResult {
  return json(statusCode, { error, code });
}

// ルートごとに必要な権限。'cognito' はブラウザのログインでのみ許可する(PAT では不可)
const ROUTE_PERMISSIONS: Record<string, string> = {
  'GET /notes': 'notes:read',
  'GET /notes/{noteId}': 'notes:read',
  'GET /tags': 'notes:read',
  'POST /notes': 'notes:write',
  'PUT /notes/{noteId}': 'notes:write',
  'POST /notes/{noteId}/append': 'notes:write',
  'DELETE /notes/{noteId}': 'notes:delete',
  'GET /users/me/settings': 'cognito',
  'PUT /users/me/settings': 'cognito',
};

/**
 * オーソライザーの context(authType・scopes)でルートの実行可否を判定する。
 * オーソライザーのポリシーはキャッシュされて他のメソッドにも使い回されるため、判定はここで行う。
 * 未知のルートは権限判定の対象外(後段で 405 になる)。
 */
export function isRouteAllowed(route: string, authorizer: { authType?: unknown; scopes?: unknown } | null | undefined): boolean {
  const required = ROUTE_PERMISSIONS[route];
  if (!required) return true;
  if (required === 'cognito') return authorizer?.authType === 'cognito';
  const scopes = typeof authorizer?.scopes === 'string' ? authorizer.scopes.split(' ') : [];
  return scopes.includes(required);
}

function actorOf(authorizer: Record<string, unknown> | null | undefined): Actor {
  if (authorizer?.authType === 'pat') {
    const actor: Actor = { type: 'agent' };
    if (typeof authorizer.tokenId === 'string' && authorizer.tokenId) actor.tokenId = authorizer.tokenId;
    if (typeof authorizer.tokenName === 'string' && authorizer.tokenName) actor.tokenName = authorizer.tokenName;
    return actor;
  }
  return { type: 'user' };
}

function parseJsonBody(body: string | null): unknown {
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new ServiceError(400, 'VALIDATION_FAILED', 'Request body is not valid JSON');
  }
}

function headerValue(headers: APIGatewayProxyEvent['headers'], name: string): string | undefined {
  const key = Object.keys(headers ?? {}).find(header => header.toLowerCase() === name.toLowerCase());
  const value = key ? headers[key] : undefined;
  return value ?? undefined;
}

const SEARCH_PARAMS = ['q', 'tag', 'limit', 'cursor', 'include'];

/** GET /notes のクエリを解釈する。検索用のパラメータが 1 つもなければ null(現行の一覧を返す) */
export function parseSearchOptions(event: Pick<APIGatewayProxyEvent, 'queryStringParameters' | 'multiValueQueryStringParameters'>): SearchOptions | null {
  const single = event.queryStringParameters ?? {};
  const multi = event.multiValueQueryStringParameters ?? {};
  if (!SEARCH_PARAMS.some(param => single[param] !== undefined || multi[param] !== undefined)) {
    return null;
  }

  const options: SearchOptions = {};
  if (single.q !== undefined) options.q = single.q;
  const tags = multi.tag ?? (single.tag !== undefined ? [single.tag] : []);
  if (tags.length > 0) options.tags = tags;
  if (single.limit !== undefined) {
    if (!/^\d+$/.test(single.limit)) {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'limit must be an integer');
    }
    options.limit = Number(single.limit);
  }
  if (single.cursor !== undefined) options.cursor = single.cursor;
  if (single.include !== undefined) {
    if (single.include !== 'snippet' && single.include !== 'content') {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'include must be "snippet" or "content"');
    }
    options.include = single.include;
  }
  return options;
}

/**
 * 表示名のバリデーション
 */
function validateDisplayName(input: string): { isValid: boolean; displayName?: string; error?: string } {
  if (typeof input !== 'string') {
    return { isValid: false, error: '表示名は文字列である必要があります' };
  }

  // 前後空白をトリミング
  let displayName = input.trim();

  // NFC正規化
  displayName = displayName.normalize('NFC');

  // 空文字チェック
  if (displayName.length === 0) {
    return { isValid: false, error: '表示名を入力してください' };
  }

  // 制御文字とゼロ幅文字を除外
  const controlCharRegex = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
  displayName = displayName.replace(controlCharRegex, '');

  // 再度空文字チェック（制御文字除去後）
  if (displayName.length === 0) {
    return { isValid: false, error: '有効な文字を含む表示名を入力してください' };
  }

  // 最大100文字チェック（正規化・制御文字除去後）
  if (displayName.length > 100) {
    return { isValid: false, error: '表示名は100文字以内で入力してください' };
  }

  return { isValid: true, displayName };
}

export interface HandlerOptions extends NotesServiceOptions {
  notesPrefix: string;
}

export function createHandler(storage: ObjectStorage, options: HandlerOptions) {
  const now = options.now ?? (() => new Date());
  const settingsKey = (userId: string) => `${options.notesPrefix}users/${userId}/settings.json`;

  async function getUserSettings(userId: string): Promise<APIGatewayProxyResult> {
    const object = await storage.get(settingsKey(userId));
    if (!object) {
      console.log(`Settings not found for user: ${userId}`);
      return errorResponse(404, 'SETTINGS_NOT_FOUND', 'Settings not found');
    }
    console.log(`Settings retrieved successfully for user: ${userId}`);
    return json(200, JSON.parse(object.body));
  }

  async function updateUserSettings(userId: string, body: unknown): Promise<APIGatewayProxyResult> {
    const settingsData = (typeof body === 'object' && body !== null ? body : {}) as Partial<UserSettings>;
    if (!settingsData.displayName) {
      return errorResponse(400, 'VALIDATION_FAILED', '表示名は必須です');
    }

    const validation = validateDisplayName(settingsData.displayName);
    if (!validation.isValid) {
      return errorResponse(400, 'VALIDATION_FAILED', validation.error!);
    }

    // 既存の設定を取得（createdAtを保持するため）
    let existingSettings: UserSettings | null = null;
    try {
      const object = await storage.get(settingsKey(userId));
      existingSettings = object ? JSON.parse(object.body) : null;
    } catch (error) {
      console.error('Error getting existing settings:', error);
    }

    const timestamp = now().toISOString();
    const settings: UserSettings = {
      displayName: validation.displayName!,
      createdAt: existingSettings?.createdAt || timestamp,
      updatedAt: timestamp,
    };
    await storage.put(settingsKey(userId), JSON.stringify(settings));

    console.log(`Settings updated successfully for user: ${userId}`);
    return json(200, settings);
  }

  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const result = await dispatch(event);
    return { ...result, headers: { ...corsHeadersFor(event.headers), ...result.headers } };
  };

  async function dispatch(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    const route = `${event.httpMethod} ${event.resource}`;
    try {
      if (event.httpMethod === 'OPTIONS') {
        return json(204, undefined, { 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS' });
      }

      // Lambda オーソライザーが検証済みのユーザー ID を context で渡す
      const authorizer = event.requestContext.authorizer;
      const userId = authorizer?.userId;
      if (!userId) {
        return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized');
      }
      if (!isRouteAllowed(route, authorizer)) {
        return errorResponse(403, 'INSUFFICIENT_SCOPE', 'このトークンにはこの操作の権限がありません');
      }

      // Sanitize user ID to prevent path traversal
      const sanitizedUserId = String(userId).replace(/[^a-zA-Z0-9-]/g, '');
      const notes = createNotesService(storage, `${options.notesPrefix}${sanitizedUserId}/`, options);
      const actor = actorOf(authorizer);

      switch (route) {
        case 'GET /notes': {
          const searchOptions = parseSearchOptions(event);
          // パラメータがなければ現行と同じレスポンス(フロントエンドとの後方互換)
          if (!searchOptions) {
            return json(200, { notes: await notes.listSummaries() });
          }
          return json(200, await notes.search(searchOptions));
        }

        case 'GET /tags':
          return json(200, { tags: await notes.listTags() });

        case 'POST /notes': {
          const { note, etag } = await notes.createNote(parseNoteInput(parseJsonBody(event.body)), actor);
          return json(201, { note }, { ETag: etag });
        }

        case 'GET /notes/{noteId}': {
          const { note, etag } = await notes.getNote(validateNoteId(event.pathParameters?.noteId));
          return json(200, { note }, { ETag: etag });
        }

        case 'PUT /notes/{noteId}': {
          const id = validateNoteId(event.pathParameters?.noteId);
          const input = parseNoteInput(parseJsonBody(event.body));
          // If-Match がなければ従来どおり上書きする(フロントエンドとの後方互換)
          const { note, etag } = await notes.updateNote(id, input, actor, headerValue(event.headers, 'If-Match'));
          return json(200, { note }, { ETag: etag });
        }

        case 'POST /notes/{noteId}/append': {
          const id = validateNoteId(event.pathParameters?.noteId);
          const body = parseJsonBody(event.body) as { text?: unknown; separator?: unknown } | null;
          const { note, etag } = await notes.appendToNote(id, body?.text, body?.separator, actor);
          return json(200, { note }, { ETag: etag });
        }

        case 'DELETE /notes/{noteId}':
          await notes.deleteNote(validateNoteId(event.pathParameters?.noteId));
          return json(204, undefined);

        case 'GET /users/me/settings':
          return await getUserSettings(sanitizedUserId);

        case 'PUT /users/me/settings':
          return await updateUserSettings(sanitizedUserId, parseJsonBody(event.body));

        default:
          return errorResponse(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
      }
    } catch (error) {
      if (error instanceof ServiceError) {
        return errorResponse(error.status, error.code, error.message);
      }
      console.error('Error:', error);
      return errorResponse(500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }
}

export const handler = createHandler(
  createS3Storage(new S3Client({ region: process.env.AWS_REGION }), process.env.NOTES_BUCKET!),
  { notesPrefix: process.env.NOTES_PREFIX || '' }
);
