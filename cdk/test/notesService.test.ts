import {
  createNotesService,
  makeSnippet,
  MAX_CONTENT_BYTES,
  parseNoteInput,
  ServiceError,
} from '../lambda/notesService';
import { memoryStorage } from './helpers/memoryStorage';

const PREFIX = 'prod/user-1/';
const NOW = new Date('2026-09-28T00:00:00.000Z');
const USER = { type: 'user' } as const;
const AGENT = { type: 'agent', tokenId: 'ABCDEFGHJKMNPQRS', tokenName: 'Claude Code' } as const;

function stored(overrides: Record<string, unknown> = {}) {
  return {
    title: 'メモ',
    content: '本文',
    tags: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function service(storage: ReturnType<typeof memoryStorage>['storage']) {
  let seq = 0;
  return createNotesService(storage, PREFIX, { now: () => NOW, generateId: () => `note-new-${++seq}` });
}

async function expectServiceError(promise: Promise<unknown>, status: number, code: string) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await promise.catch((error: ServiceError) => {
    expect(error.status).toBe(status);
    expect(error.code).toBe(code);
  });
}

describe('parseNoteInput', () => {
  it('title・content・tags・pinned だけを取り出し、それ以外は無視する', () => {
    expect(parseNoteInput({
      title: 't', content: 'c', tags: [' a ', 'a', 1], pinned: 'yes', id: 'x', createdAt: 'x', evil: true,
    })).toEqual({ title: 't', content: 'c', tags: ['a'], pinned: false });
  });

  it('型が違えば 400、上限を超えたら 413', () => {
    expect(() => parseNoteInput([])).toThrow(ServiceError);
    expect(() => parseNoteInput({ title: 1 })).toThrow('title must be a string');
    expect(() => parseNoteInput({ content: {} })).toThrow('content must be a string');
    try {
      parseNoteInput({ title: 'a'.repeat(201) });
      fail('should throw');
    } catch (error) {
      expect((error as ServiceError).status).toBe(413);
      expect((error as ServiceError).code).toBe('PAYLOAD_TOO_LARGE');
    }
    // 1 MB はバイト数で数える(日本語は 1 文字 3 バイト)
    expect(() => parseNoteInput({ content: 'あ'.repeat(Math.floor(MAX_CONTENT_BYTES / 3)) })).not.toThrow();
    expect(() => parseNoteInput({ content: 'あ'.repeat(Math.floor(MAX_CONTENT_BYTES / 3) + 1) })).toThrow('content must be at most');
  });
});

describe('makeSnippet', () => {
  it('一致箇所の前後 100 文字を返す', () => {
    const content = `${'前'.repeat(150)}キーワード${'後'.repeat(150)}`;
    expect(makeSnippet(content, 'キーワード')).toBe(`…${'前'.repeat(100)}キーワード${'後'.repeat(100)}…`);
  });

  it('大文字小文字を区別せず、先頭付近なら省略記号を付けない', () => {
    expect(makeSnippet('Hello World', 'world')).toBe('Hello World');
  });

  it('本文に一致しなければ先頭を返す', () => {
    expect(makeSnippet('a'.repeat(300), 'zzz')).toBe(`${'a'.repeat(200)}…`);
  });
});

describe('listSummaries', () => {
  it('現行と同じ形のサマリを返し、壊れたデータも正規化する', async () => {
    const { storage } = memoryStorage({
      [`${PREFIX}note-1.json`]: stored({ tags: ['a', 1, 'a'], pinned: 'yes', extra: 'x' }),
      [`${PREFIX}note-2.json`]: '{broken',
      [`${PREFIX}sub/note-3.json`]: stored(),
      'prod/user-2/note-4.json': stored(),
    });
    expect(await service(storage).listSummaries()).toEqual([
      {
        id: 'note-1',
        title: 'メモ',
        tags: ['a'],
        pinned: false,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]);
  });
});

describe('search', () => {
  const { storage } = memoryStorage({
    [`${PREFIX}note-a.json`]: stored({ title: '会議メモ', content: 'スプリント計画', tags: ['仕事', '会議'], updatedAt: '2026-09-03T00:00:00.000Z' }),
    [`${PREFIX}note-b.json`]: stored({ title: '買い物', content: 'Sprint ではない', tags: ['私用'], updatedAt: '2026-09-02T00:00:00.000Z' }),
    [`${PREFIX}note-c.json`]: stored({ title: 'スプリント振り返り', content: '良かった点', tags: ['仕事'], updatedAt: '2026-09-04T00:00:00.000Z' }),
  });
  const notes = service(storage);
  const ids = (result: { notes: { id: string }[] }) => result.notes.map(note => note.id);

  it('タイトルと本文を大文字小文字を区別せずに検索し、updatedAt の降順で返す', async () => {
    expect(ids(await notes.search({ q: 'スプリント' }))).toEqual(['note-c', 'note-a']);
    expect(ids(await notes.search({ q: 'SPRINT' }))).toEqual(['note-b']);
  });

  it('タグを複数指定すると AND で絞り込む', async () => {
    expect(ids(await notes.search({ tags: ['仕事'] }))).toEqual(['note-c', 'note-a']);
    expect(ids(await notes.search({ tags: ['仕事', '会議'] }))).toEqual(['note-a']);
    expect(ids(await notes.search({ q: '振り返り', tags: ['会議'] }))).toEqual([]);
  });

  it('include=snippet / content で本文の抜粋・全文を付ける(指定しなければ付けない)', async () => {
    const [plain] = (await notes.search({ q: '計画' })).notes;
    expect(plain).not.toHaveProperty('snippet');
    expect(plain).not.toHaveProperty('content');
    expect((await notes.search({ q: '計画', include: 'snippet' })).notes[0].snippet).toBe('スプリント計画');
    expect((await notes.search({ q: '計画', include: 'content' })).notes[0].content).toBe('スプリント計画');
  });

  it('limit と cursor でページングする', async () => {
    const first = await notes.search({ limit: 2 });
    expect(ids(first)).toEqual(['note-c', 'note-a']);
    expect(first.nextCursor).not.toBeNull();
    const second = await notes.search({ limit: 2, cursor: first.nextCursor! });
    expect(ids(second)).toEqual(['note-b']);
    expect(second.nextCursor).toBeNull();
  });

  it('limit・cursor が不正なら 400', async () => {
    await expectServiceError(notes.search({ limit: 0 }), 400, 'VALIDATION_FAILED');
    await expectServiceError(notes.search({ limit: 201 }), 400, 'VALIDATION_FAILED');
    await expectServiceError(notes.search({ cursor: 'not-a-cursor' }), 400, 'VALIDATION_FAILED');
  });
});

describe('listTags', () => {
  it('タグと件数を件数の多い順で返す', async () => {
    const { storage } = memoryStorage({
      [`${PREFIX}note-a.json`]: stored({ tags: ['仕事', '会議'] }),
      [`${PREFIX}note-b.json`]: stored({ tags: ['仕事'] }),
    });
    expect(await service(storage).listTags()).toEqual([
      { name: '仕事', count: 2 },
      { name: '会議', count: 1 },
    ]);
  });
});

describe('createNote / getNote', () => {
  it('作成したノートを ETag 付きで取得でき、作成者が記録される', async () => {
    const { storage } = memoryStorage();
    const notes = service(storage);
    const created = await notes.createNote({ title: '', content: 'x', tags: ['a'] }, AGENT);

    expect(created.note).toEqual({
      id: 'note-new-1',
      title: 'Untitled',
      content: 'x',
      tags: ['a'],
      pinned: false,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      lastModifiedBy: AGENT,
    });
    const fetched = await notes.getNote('note-new-1');
    expect(fetched).toEqual({ note: created.note, etag: created.etag });
  });

  it('存在しないノートは 404', async () => {
    const { storage } = memoryStorage();
    await expectServiceError(service(storage).getNote('note-x'), 404, 'NOTE_NOT_FOUND');
  });
});

describe('updateNote', () => {
  it('指定したフィールドだけを更新し、id・createdAt は変えない', async () => {
    const { storage, read } = memoryStorage({ [`${PREFIX}note-1.json`]: stored({ tags: ['a'] }) });
    const { note } = await service(storage).updateNote('note-1', { content: '新しい本文' }, USER);

    expect(note).toMatchObject({ id: 'note-1', title: 'メモ', content: '新しい本文', tags: ['a'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: NOW.toISOString(), lastModifiedBy: USER });
    expect(read(`${PREFIX}note-1.json`)).toEqual(note);
  });

  it('ピン留めの切り替えだけなら updatedAt と更新者を変えない', async () => {
    const { storage } = memoryStorage({ [`${PREFIX}note-1.json`]: stored({ lastModifiedBy: USER }) });
    const { note } = await service(storage).updateNote('note-1', { pinned: true }, AGENT);
    expect(note).toMatchObject({ pinned: true, updatedAt: '2026-09-01T00:00:00.000Z', lastModifiedBy: USER });
  });

  it('If-Match が一致すれば更新、一致しなければ 409 で書き込まない', async () => {
    const { storage, read } = memoryStorage({ [`${PREFIX}note-1.json`]: stored() });
    const notes = service(storage);
    const { etag } = await notes.getNote('note-1');

    const updated = await notes.updateNote('note-1', { content: '1 回目' }, USER, etag);
    expect(updated.etag).not.toBe(etag);

    // 古い ETag での更新は競合
    await expectServiceError(notes.updateNote('note-1', { content: '2 回目' }, USER, etag), 409, 'CONFLICT');
    expect(read(`${PREFIX}note-1.json`).content).toBe('1 回目');
    // ダブルクォートなしの ETag も受け付ける
    await notes.updateNote('note-1', { content: '3 回目' }, USER, updated.etag.replace(/"/g, ''));
    expect(read(`${PREFIX}note-1.json`).content).toBe('3 回目');
  });

  it('If-Match を指定して読み出し後に競合したら、再試行せず 409', async () => {
    const { storage, externalWrite, read } = memoryStorage({ [`${PREFIX}note-1.json`]: stored() });
    const notes = service(storage);
    const { etag } = await notes.getNote('note-1');
    storage.beforePut = () => {
      storage.beforePut = undefined;
      externalWrite(`${PREFIX}note-1.json`, stored({ content: '他の人の編集' }));
    };
    await expectServiceError(notes.updateNote('note-1', { content: '自分の編集' }, USER, etag), 409, 'CONFLICT');
    expect(read(`${PREFIX}note-1.json`).content).toBe('他の人の編集');
  });

  it('If-Match なしなら競合時に読み直して再試行し、ほかの変更を消さない', async () => {
    const { storage, externalWrite, read } = memoryStorage({ [`${PREFIX}note-1.json`]: stored() });
    storage.beforePut = () => {
      storage.beforePut = undefined;
      externalWrite(`${PREFIX}note-1.json`, stored({ tags: ['他の人が付けたタグ'] }));
    };
    await service(storage).updateNote('note-1', { content: '自分の編集' }, USER);
    expect(read(`${PREFIX}note-1.json`)).toMatchObject({ content: '自分の編集', tags: ['他の人が付けたタグ'] });
  });

  it('存在しないノートは 404(作成しない)', async () => {
    const { storage, objects } = memoryStorage();
    await expectServiceError(service(storage).updateNote('note-x', { content: 'x' }, USER), 404, 'NOTE_NOT_FOUND');
    expect(objects.size).toBe(0);
  });
});

describe('appendToNote', () => {
  it('区切り(既定は空行)を挟んで追記し、空のノートには区切りを入れない', async () => {
    const { storage } = memoryStorage({
      [`${PREFIX}note-1.json`]: stored({ content: '1 行目' }),
      [`${PREFIX}note-2.json`]: stored({ content: '' }),
    });
    const notes = service(storage);

    expect((await notes.appendToNote('note-1', '追記', undefined, AGENT)).note).toMatchObject({
      content: '1 行目\n\n追記',
      updatedAt: NOW.toISOString(),
      lastModifiedBy: AGENT,
    });
    expect((await notes.appendToNote('note-1', '次', '\n- ', AGENT)).note.content).toBe('1 行目\n\n追記\n- 次');
    expect((await notes.appendToNote('note-2', '最初', undefined, AGENT)).note.content).toBe('最初');
  });

  it('競合したら読み直して再試行し、両方の追記が残る', async () => {
    const { storage, externalWrite, read } = memoryStorage({ [`${PREFIX}note-1.json`]: stored({ content: 'A' }) });
    storage.beforePut = () => {
      storage.beforePut = undefined;
      externalWrite(`${PREFIX}note-1.json`, stored({ content: 'A\n\nB' }));
    };
    await service(storage).appendToNote('note-1', 'C', undefined, AGENT);
    expect(read(`${PREFIX}note-1.json`).content).toBe('A\n\nB\n\nC');
  });

  it('競合が続いたら 3 回で諦めて 409', async () => {
    const { storage, externalWrite } = memoryStorage({ [`${PREFIX}note-1.json`]: stored({ content: 'A' }) });
    let writes = 0;
    storage.beforePut = () => {
      writes++;
      externalWrite(`${PREFIX}note-1.json`, stored({ content: `他 ${writes}` }));
    };
    await expectServiceError(service(storage).appendToNote('note-1', 'C', undefined, AGENT), 409, 'CONFLICT');
    expect(writes).toBe(3);
  });

  it('入力が不正なら 400、追記後に 1 MB を超えるなら 413', async () => {
    const { storage } = memoryStorage({ [`${PREFIX}note-1.json`]: stored({ content: 'a'.repeat(MAX_CONTENT_BYTES - 1) }) });
    const notes = service(storage);
    await expectServiceError(notes.appendToNote('note-1', '', undefined, AGENT), 400, 'VALIDATION_FAILED');
    await expectServiceError(notes.appendToNote('note-1', 1, undefined, AGENT), 400, 'VALIDATION_FAILED');
    await expectServiceError(notes.appendToNote('note-1', 'x', 'x'.repeat(11), AGENT), 400, 'VALIDATION_FAILED');
    await expectServiceError(notes.appendToNote('note-1', 'xx', '', AGENT), 413, 'PAYLOAD_TOO_LARGE');
  });
});
