import { APIGatewayProxyEvent } from 'aws-lambda';

process.env.NOTES_BUCKET = 'test-bucket';

import { createHandler } from '../lambda/index';
import { memoryStorage } from './helpers/memoryStorage';

const NOW = new Date('2026-09-28T00:00:00.000Z');
const PREFIX = 'prod/user-1/';
const COGNITO = { userId: 'user-1', authType: 'cognito', scopes: 'notes:read notes:write notes:delete' };
const PAT = { userId: 'user-1', authType: 'pat', tokenId: 'ABCDEFGHJKMNPQRS', tokenName: 'Claude Code', scopes: 'notes:read notes:write' };

interface EventOptions {
  body?: unknown;
  noteId?: string;
  query?: Record<string, string>;
  multiQuery?: Record<string, string[]>;
  headers?: Record<string, string>;
  auth?: Record<string, string>;
}

function event(route: string, options: EventOptions = {}): APIGatewayProxyEvent {
  const [httpMethod, resource] = route.split(' ');
  return {
    httpMethod,
    resource,
    body: options.body === undefined ? null : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
    pathParameters: options.noteId ? { noteId: options.noteId } : null,
    queryStringParameters: options.query ?? null,
    multiValueQueryStringParameters: options.multiQuery ?? (options.query ? Object.fromEntries(Object.entries(options.query).map(([k, v]) => [k, [v]])) : null),
    headers: options.headers ?? {},
    requestContext: { authorizer: options.auth ?? COGNITO },
  } as unknown as APIGatewayProxyEvent;
}

function setup(initial: Record<string, unknown> = {}) {
  const store = memoryStorage(initial);
  const handler = createHandler(store.storage, { notesPrefix: 'prod/', now: () => NOW, generateId: () => 'note-new' });
  return { ...store, handler };
}

const body = (result: { body: string }) => JSON.parse(result.body);

const NOTE = {
  title: 'メモ',
  content: '本文',
  tags: ['仕事'],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('GET /notes', () => {
  it('パラメータなしは現行と同じ { notes: サマリ[] }', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const result = await handler(event('GET /notes'));
    expect(result.statusCode).toBe(200);
    expect(body(result)).toEqual({
      notes: [{ id: 'note-1', title: 'メモ', tags: ['仕事'], pinned: false, createdAt: NOTE.createdAt, updatedAt: NOTE.updatedAt }],
    });
  });

  it('検索パラメータがあれば nextCursor 付きで返す。tag は複数指定できる', async () => {
    const { handler } = setup({
      [`${PREFIX}note-1.json`]: NOTE,
      [`${PREFIX}note-2.json`]: { ...NOTE, tags: ['仕事', '会議'] },
    });
    const result = await handler(event('GET /notes', { multiQuery: { tag: ['仕事', '会議'] }, query: { tag: '会議', include: 'snippet' } }));
    expect(body(result)).toEqual({
      notes: [expect.objectContaining({ id: 'note-2', snippet: '本文' })],
      nextCursor: null,
    });
  });

  it('不正なパラメータは 400 VALIDATION_FAILED', async () => {
    const { handler } = setup();
    const invalidQueries: Record<string, string>[] = [{ limit: 'abc' }, { limit: '500' }, { include: 'everything' }, { cursor: '!!' }];
    for (const query of invalidQueries) {
      const result = await handler(event('GET /notes', { query }));
      expect(result.statusCode).toBe(400);
      expect(body(result).code).toBe('VALIDATION_FAILED');
    }
  });
});

describe('GET /tags', () => {
  it('タグと件数を返す', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    expect(body(await handler(event('GET /tags')))).toEqual({ tags: [{ name: '仕事', count: 1 }] });
  });
});

describe('GET / PUT /notes/{noteId}', () => {
  it('GET は ETag ヘッダーを付け、ブラウザから読めるように公開する', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const result = await handler(event('GET /notes/{noteId}', { noteId: 'note-1' }));
    expect(result.statusCode).toBe(200);
    expect(result.headers).toMatchObject({ ETag: '"v1"', 'Access-Control-Expose-Headers': 'ETag' });
    expect(body(result).note).toMatchObject({ id: 'note-1', content: '本文' });
  });

  it('If-Match が一致しなければ 409 CONFLICT、なければ従来どおり上書き', async () => {
    const { handler, read } = setup({ [`${PREFIX}note-1.json`]: NOTE });

    const conflict = await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { content: 'x' }, headers: { 'if-match': '"stale"' } }));
    expect(conflict.statusCode).toBe(409);
    expect(body(conflict)).toEqual({ error: expect.any(String), code: 'CONFLICT' });

    const ok = await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { content: 'x' }, headers: { 'If-Match': '"v1"' } }));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers?.ETag).toBe('"v2"');

    const overwrite = await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { content: 'y' } }));
    expect(overwrite.statusCode).toBe(200);
    expect(read(`${PREFIX}note-1.json`).content).toBe('y');
  });

  it('PUT は許可したフィールド以外を保存しない', async () => {
    const { handler, read } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { title: 't', id: 'hijack', createdAt: '1999', isAdmin: true } }));
    const saved = read(`${PREFIX}note-1.json`);
    expect(saved).toMatchObject({ id: 'note-1', title: 't', createdAt: NOTE.createdAt });
    expect(saved).not.toHaveProperty('isAdmin');
  });

  it('PAT での更新は agent として記録される', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const result = await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { content: 'x' }, auth: PAT }));
    expect(body(result).note.lastModifiedBy).toEqual({ type: 'agent', tokenId: 'ABCDEFGHJKMNPQRS', tokenName: 'Claude Code' });
  });

  it('存在しないノートは 404 NOTE_NOT_FOUND(従来の error も残す)', async () => {
    const { handler } = setup();
    const result = await handler(event('GET /notes/{noteId}', { noteId: 'note-x' }));
    expect(result.statusCode).toBe(404);
    expect(body(result)).toEqual({ error: 'Note not found', code: 'NOTE_NOT_FOUND' });
  });

  it('上限を超える入力は 413、壊れた JSON は 400', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const tooLong = await handler(event('PUT /notes/{noteId}', { noteId: 'note-1', body: { title: 'a'.repeat(201) } }));
    expect(tooLong.statusCode).toBe(413);
    expect(body(tooLong).code).toBe('PAYLOAD_TOO_LARGE');
    const broken = await handler(event('POST /notes', { body: '{broken' }));
    expect(broken.statusCode).toBe(400);
    expect(body(broken).code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /notes/{noteId}/append', () => {
  it('追記して ETag を返す', async () => {
    const { handler } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const result = await handler(event('POST /notes/{noteId}/append', { noteId: 'note-1', body: { text: '追記' }, auth: PAT }));
    expect(result.statusCode).toBe(200);
    expect(result.headers?.ETag).toBe('"v2"');
    expect(body(result).note.content).toBe('本文\n\n追記');
  });

  it('notes:read だけの PAT では 403 INSUFFICIENT_SCOPE', async () => {
    const { handler, read } = setup({ [`${PREFIX}note-1.json`]: NOTE });
    const result = await handler(event('POST /notes/{noteId}/append', {
      noteId: 'note-1',
      body: { text: '追記' },
      auth: { ...PAT, scopes: 'notes:read' },
    }));
    expect(result.statusCode).toBe(403);
    expect(body(result).code).toBe('INSUFFICIENT_SCOPE');
    expect(read(`${PREFIX}note-1.json`).content).toBe('本文');
  });
});

describe('POST /notes', () => {
  it('作成すると 201 と ETag を返す', async () => {
    const { handler } = setup();
    const result = await handler(event('POST /notes', { body: { title: '新規', content: 'x' } }));
    expect(result.statusCode).toBe(201);
    expect(result.headers?.ETag).toBe('"v1"');
    expect(body(result).note).toMatchObject({ id: 'note-new', title: '新規', lastModifiedBy: { type: 'user' } });
  });
});

describe('設定 API(従来の挙動)', () => {
  it('未設定は 404、保存すると取得できる', async () => {
    const { handler } = setup();
    expect((await handler(event('GET /users/me/settings'))).statusCode).toBe(404);
    const saved = await handler(event('PUT /users/me/settings', { body: { displayName: '  テスト  ' } }));
    expect(body(saved)).toEqual({ displayName: 'テスト', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(body(await handler(event('GET /users/me/settings'))).displayName).toBe('テスト');
  });

  it('PAT では設定を扱えない', async () => {
    const { handler } = setup();
    expect((await handler(event('GET /users/me/settings', { auth: PAT }))).statusCode).toBe(403);
  });
});

it('認証情報がなければ 401 UNAUTHORIZED', async () => {
  const { handler } = setup();
  const result = await handler(event('GET /notes', { auth: {} }));
  expect(result.statusCode).toBe(401);
  expect(body(result).code).toBe('UNAUTHORIZED');
});
