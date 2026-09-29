import { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/**
 * MCP の認可仕様を満たす最小限の OAuth 2.1 認可サーバー(ファサード)。
 * ユーザー認証は既存の Google + Cognito に任せ(同意画面から Cognito の ID トークンで approve を呼ぶ)、
 * ここでは同意を得て snb_ 形式のアクセストークンを発行することだけを行う。
 * 発行するアクセストークンは PAT と同じ形式・同じ保存先なので、オーソライザーは区別せずに検証できる。
 */

// ---- 型 ----

export interface ClientRecord {
  PK: string;
  SK: 'META';
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
  lastUsedAt: string;
  ttl: number;
}

export interface AuthRequestRecord {
  PK: string;
  SK: 'META';
  requestId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  state?: string;
  expiresAt: string;
  ttl: number;
}

export interface CodeRecord {
  PK: string;
  SK: 'META';
  userId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string;
  expiresAt: string;
  ttl: number;
}

/** アクセストークン(PAT と同じ形。オーソライザーが検証する) */
export interface AccessTokenRecord {
  PK: string;
  SK: 'META';
  tokenId: string;
  kind: 'oauth';
  userId: string;
  name: string;
  secretHash: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  clientId: string;
  familyId: string;
  resource: string;
  GSI2PK: string;
  GSI2SK: string;
  ttl: number;
}

export interface RefreshTokenRecord {
  PK: string;
  SK: 'META';
  tokenId: string;
  userId: string;
  clientId: string;
  clientName: string;
  familyId: string;
  secretHash: string;
  scopes: string[];
  resource: string;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  revokedAt?: string;
  GSI2PK: string;
  GSI2SK: string;
  ttl: number;
}

/** 接続(リフレッシュトークンの系列)。設定画面のトークン一覧に表示し、ここから失効させる */
export interface ConnectionRecord {
  PK: string;
  SK: 'META';
  tokenId: string;
  kind: 'oauth';
  userId: string;
  name: string;
  clientId: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  GSI1PK: string;
  GSI1SK: string;
  GSI2PK: string;
  GSI2SK: string;
  ttl: number;
}

export interface OAuthStore {
  getClient(clientId: string): Promise<ClientRecord | null>;
  putClient(record: ClientRecord): Promise<void>;
  touchClient(clientId: string, now: Date, ttl: number): Promise<void>;
  putAuthRequest(record: AuthRequestRecord): Promise<void>;
  getAuthRequest(requestId: string): Promise<AuthRequestRecord | null>;
  /** 1 回限り: 削除できたときだけレコードを返す */
  consumeAuthRequest(requestId: string): Promise<AuthRequestRecord | null>;
  putCode(record: CodeRecord): Promise<void>;
  /** 1 回限り: 削除できたときだけレコードを返す */
  consumeCode(codeHash: string): Promise<CodeRecord | null>;
  putAccessToken(record: AccessTokenRecord): Promise<void>;
  putRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshToken(tokenId: string): Promise<RefreshTokenRecord | null>;
  /** 未使用なら usedAt を設定して true。使用済み(再利用)なら false */
  markRefreshTokenUsed(tokenId: string, now: Date): Promise<boolean>;
  putConnection(record: ConnectionRecord): Promise<void>;
  getConnection(familyId: string): Promise<ConnectionRecord | null>;
  touchConnection(familyId: string, now: Date, expiresAt: string, ttl: number): Promise<void>;
  /** 系列のアクセストークン・リフレッシュトークン・接続をすべて失効させる */
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export interface OAuthConfig {
  environment: string;
  /** 認可サーバーの issuer(= MCP のホストの origin) */
  issuer: string;
  /** 保護対象のリソース(MCP の URL) */
  mcpUrl: string;
  /** 同意画面の URL(GitHub Pages) */
  consentUrl: string;
  /** 同意画面から呼ぶエンドポイントだけに付ける CORS の許可オリジン */
  allowedOrigins: string[];
}

export interface OAuthDeps {
  store: OAuthStore;
  config: OAuthConfig;
  now?: () => Date;
  random?: (size: number) => Buffer;
}

// ---- 定数 ----

// OAuth でも削除は許可しない(PAT と同じ。設計書 8 章 2)
export const OAUTH_SCOPES = ['notes:read', 'notes:write'] as const;
const DEFAULT_SCOPES = [...OAUTH_SCOPES];
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;
const AUTH_REQUEST_TTL_SECONDS = 10 * 60;
const CODE_TTL_SECONDS = 10 * 60;
const CLIENT_TTL_DAYS = 90;
const RECORD_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LENGTH = 2000;
const MAX_CLIENT_NAME_LENGTH = 100;
const MAX_STATE_LENGTH = 1024;

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
// PKCE(RFC 7636): 43〜128 文字の unreserved 文字
const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const REFRESH_PATTERN = /^snbr_([a-z0-9-]+)_([0-9A-HJKMNP-TV-Z]{16})_([A-Za-z0-9_-]{43})$/;

// ---- ユーティリティ ----

function encodeId(bytes: Buffer): string {
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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)) === code_challenge */
export function pkceMatches(verifier: string, challenge: string): boolean {
  return safeEqual(createHash('sha256').update(verifier).digest('base64url'), challenge);
}

function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** 制御文字・書式文字(ゼロ幅文字や方向制御)を取り除く */
function stripInvisible(value: string): string {
  return Array.from(value.normalize('NFC'))
    .filter(char => !/\p{Cc}|\p{Cf}/u.test(char))
    .join('')
    .trim();
}

/** リダイレクト先は https と、ネイティブアプリ用の loopback(http://localhost・127.0.0.1・[::1])だけを許可する */
export function isAllowedRedirectUri(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_REDIRECT_URI_LENGTH) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

// ---- HTTP ----

type Result = APIGatewayProxyStructuredResultV2;

function json(statusCode: number, body: unknown, headers: Record<string, string> = {}): Result {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Pragma: 'no-cache', ...headers },
    body: JSON.stringify(body),
  };
}

/** RFC 6749 形式のエラー */
function oauthError(statusCode: number, error: string, description: string): Result {
  return json(statusCode, { error, error_description: description });
}

function redirect(location: string): Result {
  return { statusCode: 302, headers: { Location: location, 'Cache-Control': 'no-store' }, body: '' };
}

function withQuery(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

function readBody(event: APIGatewayProxyEventV2): string {
  if (!event.body) return '';
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

/** トークンエンドポイントは application/x-www-form-urlencoded(標準)と JSON の両方を受け付ける */
function parseParams(event: APIGatewayProxyEventV2): Record<string, string> {
  const body = readBody(event);
  const contentType = Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === 'content-type')?.[1] ?? '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body || '{}');
      return Object.fromEntries(
        Object.entries(parsed ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(body));
}

function header(event: APIGatewayProxyEventV2, name: string): string | undefined {
  return Object.entries(event.headers ?? {}).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
}

function parseScopeParam(value: string | undefined): string[] | null {
  if (value === undefined || value.trim() === '') return [...DEFAULT_SCOPES];
  const scopes = [...new Set(value.split(/\s+/).filter(Boolean))];
  return scopes.every(scope => (OAUTH_SCOPES as readonly string[]).includes(scope)) ? scopes : null;
}

// ---- ハンドラー ----

export function createHandler(deps: OAuthDeps) {
  const { store, config } = deps;
  const now = deps.now ?? (() => new Date());
  const random = deps.random ?? randomBytes;
  const newId = () => encodeId(random(10));
  const newSecret = () => random(32).toString('base64url');
  const mcpUrl = stripTrailingSlash(config.mcpUrl);

  function corsHeaders(event: APIGatewayProxyEventV2): Record<string, string> {
    const origin = header(event, 'origin');
    return {
      'Access-Control-Allow-Origin': origin && config.allowedOrigins.includes(origin) ? origin : config.allowedOrigins[0],
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      Vary: 'Origin',
    };
  }

  function protectedResourceMetadata(): Result {
    // RFC 9728
    return json(200, {
      resource: mcpUrl,
      authorization_servers: [config.issuer],
      scopes_supported: [...OAUTH_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Simplenotebook',
    }, { 'Cache-Control': 'max-age=3600' });
  }

  function authorizationServerMetadata(): Result {
    // RFC 8414
    return json(200, {
      issuer: config.issuer,
      authorization_endpoint: `${config.issuer}/oauth/authorize`,
      token_endpoint: `${config.issuer}/oauth/token`,
      registration_endpoint: `${config.issuer}/oauth/register`,
      scopes_supported: [...OAUTH_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    }, { 'Cache-Control': 'max-age=3600' });
  }

  /** DCR(RFC 7591)。公開クライアント(PKCE 必須・シークレットなし)だけを登録する */
  async function register(event: APIGatewayProxyEventV2): Promise<Result> {
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(readBody(event) || '{}');
    } catch {
      return oauthError(400, 'invalid_client_metadata', 'Request body must be JSON');
    }
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > MAX_REDIRECT_URIS) {
      return oauthError(400, 'invalid_redirect_uri', `redirect_uris must contain 1 to ${MAX_REDIRECT_URIS} URIs`);
    }
    if (!redirectUris.every(isAllowedRedirectUri)) {
      return oauthError(400, 'invalid_redirect_uri', 'redirect_uris must be https or loopback (http://localhost, 127.0.0.1, [::1]) URIs without fragments');
    }
    if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') {
      return oauthError(400, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported');
    }
    if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) ||
      !body.grant_types.every(type => type === 'authorization_code' || type === 'refresh_token'))) {
      return oauthError(400, 'invalid_client_metadata', 'Only authorization_code and refresh_token grants are supported');
    }
    if (body.response_types !== undefined && (!Array.isArray(body.response_types) ||
      !body.response_types.every(type => type === 'code'))) {
      return oauthError(400, 'invalid_client_metadata', 'Only the "code" response type is supported');
    }
    const clientName = typeof body.client_name === 'string'
      ? stripInvisible(body.client_name).slice(0, MAX_CLIENT_NAME_LENGTH)
      : '';

    const current = now();
    const clientId = `mcp_${random(16).toString('base64url')}`;
    const record: ClientRecord = {
      PK: `CLIENT#${clientId}`,
      SK: 'META',
      clientId,
      clientName: clientName || 'MCP client',
      redirectUris: [...new Set(redirectUris)],
      createdAt: current.toISOString(),
      lastUsedAt: current.toISOString(),
      ttl: epochSeconds(current) + CLIENT_TTL_DAYS * 24 * 60 * 60,
    };
    await store.putClient(record);
    return json(201, {
      client_id: clientId,
      client_id_issued_at: epochSeconds(current),
      client_name: record.clientName,
      redirect_uris: record.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  }

  /** 認可リクエストを検証して保存し、同意画面へリダイレクトする */
  async function authorize(event: APIGatewayProxyEventV2): Promise<Result> {
    const query = event.queryStringParameters ?? {};
    const clientId = query.client_id;
    const redirectUri = query.redirect_uri;
    const client = clientId ? await store.getClient(clientId) : null;
    // クライアントかリダイレクト先が不正なときは、リダイレクトせずにエラーを表示する(オープンリダイレクトを防ぐ)
    if (!client) {
      return oauthError(400, 'invalid_request', 'Unknown client_id');
    }
    if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
      return oauthError(400, 'invalid_request', 'redirect_uri is not registered for this client');
    }

    const state = query.state;
    const fail = (error: string, description: string) =>
      redirect(withQuery(redirectUri, { error, error_description: description, state, iss: config.issuer }));

    if (state !== undefined && state.length > MAX_STATE_LENGTH) {
      return fail('invalid_request', 'state is too long');
    }
    if (query.response_type !== 'code') {
      return fail('unsupported_response_type', 'response_type must be "code"');
    }
    if (query.code_challenge_method !== 'S256' || !query.code_challenge || !PKCE_PATTERN.test(query.code_challenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
    }
    const scopes = parseScopeParam(query.scope);
    if (!scopes) {
      return fail('invalid_scope', `Supported scopes: ${OAUTH_SCOPES.join(' ')}`);
    }
    // RFC 8707: トークンの宛先は MCP の URL だけ
    if (query.resource !== undefined && stripTrailingSlash(query.resource) !== mcpUrl) {
      return fail('invalid_target', `resource must be ${mcpUrl}`);
    }

    const current = now();
    const requestId = newId();
    await store.putAuthRequest({
      PK: `AUTHREQ#${requestId}`,
      SK: 'META',
      requestId,
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri,
      codeChallenge: query.code_challenge,
      scopes,
      resource: mcpUrl,
      state,
      expiresAt: new Date(current.getTime() + AUTH_REQUEST_TTL_SECONDS * 1000).toISOString(),
      ttl: epochSeconds(current) + AUTH_REQUEST_TTL_SECONDS,
    });
    // 使われ続けているクライアントは残す(最終使用から 90 日で消える)
    await store.touchClient(client.clientId, current, epochSeconds(current) + CLIENT_TTL_DAYS * 24 * 60 * 60);
    return redirect(withQuery(config.consentUrl, { req: requestId }));
  }

  async function loadActiveRequest(requestId: string | undefined): Promise<AuthRequestRecord | null> {
    if (!requestId || !ID_PATTERN.test(requestId)) return null;
    const request = await store.getAuthRequest(requestId);
    // TTL による削除は遅れることがあるので、期限もここで確かめる
    if (!request || new Date(request.expiresAt).getTime() <= now().getTime()) return null;
    return request;
  }

  /** 同意画面に表示する内容。ログイン済み(Cognito)のユーザーだけが取得できる */
  async function describeRequest(event: APIGatewayProxyEventV2): Promise<Result> {
    const request = await loadActiveRequest(event.pathParameters?.requestId);
    if (!request) {
      return json(404, { error: 'request_not_found', error_description: 'The authorization request has expired or has already been used. Start the connection again from the client.' });
    }
    return json(200, {
      requestId: request.requestId,
      clientName: request.clientName,
      redirectUri: request.redirectUri,
      // なりすましたクライアントを見分けられるよう、リダイレクト先のホストを必ず表示する
      redirectHost: new URL(request.redirectUri).host,
      scopes: request.scopes,
      expiresAt: request.expiresAt,
    });
  }

  /** 同意(または拒否)。認可リクエストは 1 回しか使えない */
  async function approve(event: APIGatewayProxyEventV2, userId: string): Promise<Result> {
    let body: { requestId?: unknown; approve?: unknown; scopes?: unknown };
    try {
      body = JSON.parse(readBody(event) || '{}');
    } catch {
      return json(400, { error: 'invalid_request', error_description: 'Request body must be JSON' });
    }
    const request = await loadActiveRequest(typeof body.requestId === 'string' ? body.requestId : undefined);
    if (!request) {
      return json(404, { error: 'request_not_found', error_description: 'The authorization request has expired or has already been used.' });
    }

    let scopes = request.scopes;
    if (body.approve === true && body.scopes !== undefined) {
      if (!Array.isArray(body.scopes) || body.scopes.length === 0 ||
        !body.scopes.every(scope => typeof scope === 'string' && request.scopes.includes(scope))) {
        return json(400, { error: 'invalid_scope', error_description: 'scopes must be a non-empty subset of the requested scopes' });
      }
      scopes = [...new Set(body.scopes as string[])];
    }

    // 同じ認可リクエストで 2 回承認できないよう、ここで消費する
    const consumed = await store.consumeAuthRequest(request.requestId);
    if (!consumed) {
      return json(404, { error: 'request_not_found', error_description: 'The authorization request has already been used.' });
    }

    if (body.approve !== true) {
      return json(200, {
        redirectUrl: withQuery(consumed.redirectUri, {
          error: 'access_denied',
          error_description: 'The user denied the request',
          state: consumed.state,
          iss: config.issuer,
        }),
      });
    }

    const current = now();
    const code = newSecret();
    await store.putCode({
      PK: `CODE#${sha256Hex(code)}`,
      SK: 'META',
      userId,
      clientId: consumed.clientId,
      clientName: consumed.clientName,
      redirectUri: consumed.redirectUri,
      codeChallenge: consumed.codeChallenge,
      scopes,
      resource: consumed.resource,
      expiresAt: new Date(current.getTime() + CODE_TTL_SECONDS * 1000).toISOString(),
      ttl: epochSeconds(current) + CODE_TTL_SECONDS,
    });
    return json(200, {
      redirectUrl: withQuery(consumed.redirectUri, { code, state: consumed.state, iss: config.issuer }),
    });
  }

  /** アクセストークンとリフレッシュトークンの組を発行する(同じ系列 = familyId) */
  async function issueTokens(params: {
    userId: string;
    clientId: string;
    clientName: string;
    familyId: string;
    scopes: string[];
    resource: string;
    current: Date;
  }) {
    const { userId, clientId, clientName, familyId, scopes, resource, current } = params;
    const accessId = newId();
    const accessSecret = newSecret();
    const accessExpiresAt = new Date(current.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000);
    await store.putAccessToken({
      PK: `TOKEN#${accessId}`,
      SK: 'META',
      tokenId: accessId,
      kind: 'oauth',
      userId,
      name: clientName,
      secretHash: hashSecret(accessSecret),
      scopes,
      createdAt: current.toISOString(),
      expiresAt: accessExpiresAt.toISOString(),
      clientId,
      familyId,
      resource,
      GSI2PK: `FAMILY#${familyId}`,
      GSI2SK: `TOKEN#${accessId}`,
      ttl: epochSeconds(accessExpiresAt) + RECORD_RETENTION_DAYS * 24 * 60 * 60,
    });

    const refreshId = newId();
    const refreshSecret = newSecret();
    const refreshExpiresAt = new Date(current.getTime() + REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    await store.putRefreshToken({
      PK: `REFRESH#${refreshId}`,
      SK: 'META',
      tokenId: refreshId,
      userId,
      clientId,
      clientName,
      familyId,
      secretHash: hashSecret(refreshSecret),
      scopes,
      resource,
      createdAt: current.toISOString(),
      expiresAt: refreshExpiresAt.toISOString(),
      GSI2PK: `FAMILY#${familyId}`,
      GSI2SK: `REFRESH#${refreshId}`,
      ttl: epochSeconds(refreshExpiresAt),
    });

    return {
      response: {
        access_token: `snb_${config.environment}_${accessId}_${accessSecret}`,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: `snbr_${config.environment}_${refreshId}_${refreshSecret}`,
        scope: scopes.join(' '),
      },
      refreshExpiresAt,
    };
  }

  async function exchangeCode(params: Record<string, string>): Promise<Result> {
    const { code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier } = params;
    if (!code || !redirectUri || !clientId || !verifier) {
      return oauthError(400, 'invalid_request', 'code, redirect_uri, client_id and code_verifier are required');
    }
    if (!PKCE_PATTERN.test(verifier)) {
      return oauthError(400, 'invalid_grant', 'code_verifier is malformed');
    }
    // 認可コードは 1 回限り(削除できたときだけ有効)
    const record = await store.consumeCode(sha256Hex(code));
    const current = now();
    if (!record || new Date(record.expiresAt).getTime() <= current.getTime()) {
      return oauthError(400, 'invalid_grant', 'The authorization code is invalid, expired or already used');
    }
    if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
      return oauthError(400, 'invalid_grant', 'client_id or redirect_uri does not match the authorization request');
    }
    if (!pkceMatches(verifier, record.codeChallenge)) {
      return oauthError(400, 'invalid_grant', 'code_verifier does not match code_challenge');
    }
    if (params.resource !== undefined && stripTrailingSlash(params.resource) !== record.resource) {
      return oauthError(400, 'invalid_target', `resource must be ${record.resource}`);
    }

    const familyId = newId();
    const { response, refreshExpiresAt } = await issueTokens({
      userId: record.userId,
      clientId: record.clientId,
      clientName: record.clientName,
      familyId,
      scopes: record.scopes,
      resource: record.resource,
      current,
    });
    await store.putConnection({
      PK: `CONN#${familyId}`,
      SK: 'META',
      tokenId: familyId,
      kind: 'oauth',
      userId: record.userId,
      name: record.clientName,
      clientId: record.clientId,
      scopes: record.scopes,
      createdAt: current.toISOString(),
      expiresAt: refreshExpiresAt.toISOString(),
      lastUsedAt: current.toISOString(),
      GSI1PK: `USER#${record.userId}`,
      GSI1SK: `TOKEN#${current.toISOString()}`,
      GSI2PK: `FAMILY#${familyId}`,
      GSI2SK: 'CONN',
      ttl: epochSeconds(refreshExpiresAt) + RECORD_RETENTION_DAYS * 24 * 60 * 60,
    });
    return json(200, response);
  }

  async function refresh(params: Record<string, string>): Promise<Result> {
    const invalid = () => oauthError(400, 'invalid_grant', 'The refresh token is invalid, expired or revoked');
    const { refresh_token: refreshToken, client_id: clientId } = params;
    if (!refreshToken || !clientId) {
      return oauthError(400, 'invalid_request', 'refresh_token and client_id are required');
    }
    const match = REFRESH_PATTERN.exec(refreshToken);
    if (!match || match[1] !== config.environment) return invalid();
    const [, , tokenId, secret] = match;

    const record = await store.getRefreshToken(tokenId);
    const current = now();
    if (
      !record ||
      !safeEqual(hashSecret(secret), record.secretHash) ||
      record.clientId !== clientId ||
      record.revokedAt ||
      new Date(record.expiresAt).getTime() <= current.getTime()
    ) {
      return invalid();
    }
    const connection = await store.getConnection(record.familyId);
    if (!connection || connection.revokedAt) return invalid();

    // リフレッシュトークンは 1 回限り。使用済みのものが再び使われたら漏洩とみなし、系列ごと失効させる
    if (!(await store.markRefreshTokenUsed(tokenId, current))) {
      console.warn('Refresh token reuse detected. Revoking family:', record.familyId);
      await store.revokeFamily(record.familyId, current);
      return invalid();
    }

    let scopes = record.scopes;
    if (params.scope !== undefined) {
      const requested = parseScopeParam(params.scope);
      if (!requested || !requested.every(scope => record.scopes.includes(scope))) {
        return oauthError(400, 'invalid_scope', 'scope must not exceed the originally granted scopes');
      }
      scopes = requested;
    }

    const { response, refreshExpiresAt } = await issueTokens({
      userId: record.userId,
      clientId: record.clientId,
      clientName: record.clientName,
      familyId: record.familyId,
      scopes,
      resource: record.resource,
      current,
    });
    await store.touchConnection(
      record.familyId,
      current,
      refreshExpiresAt.toISOString(),
      epochSeconds(refreshExpiresAt) + RECORD_RETENTION_DAYS * 24 * 60 * 60
    );
    return json(200, response);
  }

  async function token(event: APIGatewayProxyEventV2): Promise<Result> {
    const params = parseParams(event);
    switch (params.grant_type) {
      case 'authorization_code':
        return exchangeCode(params);
      case 'refresh_token':
        return refresh(params);
      default:
        return oauthError(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
    }
  }

  return async (event: APIGatewayProxyEventV2): Promise<Result> => {
    const route = event.routeKey;
    try {
      switch (route) {
        case 'GET /.well-known/oauth-protected-resource':
        case 'GET /.well-known/oauth-protected-resource/mcp':
          return protectedResourceMetadata();
        case 'GET /.well-known/oauth-authorization-server':
          return authorizationServerMetadata();
        case 'POST /oauth/register':
          return await register(event);
        case 'GET /oauth/authorize':
          return await authorize(event);
        case 'POST /oauth/token':
          return await token(event);
        case 'OPTIONS /oauth/approve':
        case 'OPTIONS /oauth/requests/{requestId}':
          return { statusCode: 204, headers: corsHeaders(event), body: '' };
        case 'GET /oauth/requests/{requestId}':
        case 'POST /oauth/approve': {
          const authorizer = (event.requestContext as { authorizer?: { lambda?: Record<string, string> } }).authorizer?.lambda;
          // 同意はブラウザでログインした本人だけができる(アクセストークンで同意して権限を広げられないようにする)
          const result = !authorizer?.userId
            ? json(401, { error: 'unauthorized', error_description: 'Sign in required' })
            : authorizer.authType !== 'cognito'
              ? json(403, { error: 'forbidden', error_description: 'Consent must be given from the browser' })
              : route === 'POST /oauth/approve'
                ? await approve(event, authorizer.userId)
                : await describeRequest(event);
          return { ...result, headers: { ...result.headers, ...corsHeaders(event) } };
        }
        default:
          return oauthError(404, 'not_found', 'Not found');
      }
    } catch (error) {
      console.error('OAuth error:', error);
      return oauthError(500, 'server_error', 'Internal server error');
    }
  };
}

// ---- DynamoDB の実装 ----

export function createDynamoOAuthStore(tableName: string, client = DynamoDBDocumentClient.from(new DynamoDBClient({}))): OAuthStore {
  const get = async <T>(pk: string): Promise<T | null> => {
    const result = await client.send(new GetCommand({ TableName: tableName, Key: { PK: pk, SK: 'META' } }));
    return (result.Item as T | undefined) ?? null;
  };
  const put = async (item: object) => {
    await client.send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK)' }));
  };
  const consume = async <T>(pk: string): Promise<T | null> => {
    try {
      const result = await client.send(new DeleteCommand({
        TableName: tableName,
        Key: { PK: pk, SK: 'META' },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_OLD',
      }));
      return (result.Attributes as T | undefined) ?? null;
    } catch (error) {
      if ((error as Error).name === 'ConditionalCheckFailedException') return null;
      throw error;
    }
  };
  const ignoreConditionFailure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      if ((error as Error).name !== 'ConditionalCheckFailedException') throw error;
    }
  };

  return {
    getClient: clientId => get<ClientRecord>(`CLIENT#${clientId}`),
    putClient: put,
    async touchClient(clientId, now, ttl) {
      await ignoreConditionFailure(client.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `CLIENT#${clientId}`, SK: 'META' },
        UpdateExpression: 'SET lastUsedAt = :now, #ttl = :ttl',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':now': now.toISOString(), ':ttl': ttl },
      })));
    },
    putAuthRequest: put,
    getAuthRequest: requestId => get<AuthRequestRecord>(`AUTHREQ#${requestId}`),
    consumeAuthRequest: requestId => consume<AuthRequestRecord>(`AUTHREQ#${requestId}`),
    putCode: put,
    consumeCode: codeHash => consume<CodeRecord>(`CODE#${codeHash}`),
    putAccessToken: put,
    putRefreshToken: put,
    getRefreshToken: tokenId => get<RefreshTokenRecord>(`REFRESH#${tokenId}`),
    async markRefreshTokenUsed(tokenId, now) {
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { PK: `REFRESH#${tokenId}`, SK: 'META' },
          UpdateExpression: 'SET usedAt = :now',
          ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(usedAt)',
          ExpressionAttributeValues: { ':now': now.toISOString() },
        }));
        return true;
      } catch (error) {
        if ((error as Error).name === 'ConditionalCheckFailedException') return false;
        throw error;
      }
    },
    putConnection: put,
    getConnection: familyId => get<ConnectionRecord>(`CONN#${familyId}`),
    async touchConnection(familyId, now, expiresAt, ttl) {
      await ignoreConditionFailure(client.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `CONN#${familyId}`, SK: 'META' },
        UpdateExpression: 'SET lastUsedAt = :now, expiresAt = :expiresAt, #ttl = :ttl',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':now': now.toISOString(), ':expiresAt': expiresAt, ':ttl': ttl },
      })));
    },
    revokeFamily: (familyId, now) => revokeFamilyInTable(client, tableName, familyId, now),
  };
}

/** 系列(GSI2 = FAMILY#<familyId>)のレコードをすべて失効させる。トークン管理 API からも使う */
export async function revokeFamilyInTable(client: DynamoDBDocumentClient, tableName: string, familyId: string, now: Date): Promise<void> {
  const keys: { PK: string; SK: string }[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await client.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `FAMILY#${familyId}` },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    keys.push(...(result.Items ?? []).map(item => ({ PK: item.PK as string, SK: item.SK as string })));
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  await Promise.all(keys.map(key => client.send(new UpdateCommand({
    TableName: tableName,
    Key: key,
    UpdateExpression: 'SET revokedAt = if_not_exists(revokedAt, :now)',
    ExpressionAttributeValues: { ':now': now.toISOString() },
  }))));
}

export const handler = createHandler({
  store: createDynamoOAuthStore(process.env.AUTH_TABLE_NAME!),
  config: {
    environment: process.env.ENVIRONMENT!,
    issuer: stripTrailingSlash(process.env.ISSUER ?? ''),
    mcpUrl: process.env.MCP_URL ?? '',
    consentUrl: process.env.CONSENT_URL ?? '',
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
  },
});
