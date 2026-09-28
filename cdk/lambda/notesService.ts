import { ObjectStorage, PreconditionFailedError } from './storage';

/**
 * ノート操作の共通処理。REST(index.ts)と MCP(B-19)から使う。
 * HTTP に依存しない形で書き、失敗は ServiceError(HTTP ステータスとエラーコード付き)で返す。
 */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'PAYLOAD_TOO_LARGE'
  | 'NOTE_NOT_FOUND'
  | 'CONFLICT';

export class ServiceError extends Error {
  constructor(public status: number, public code: ErrorCode, message: string) {
    super(message);
    this.name = 'ServiceError';
  }
}

/** 誰が最後に変更したか。UI で「エージェントによる編集」と区別できるようにする */
export type Actor =
  | { type: 'user' }
  | { type: 'agent'; tokenId?: string; tokenName?: string };

export interface Note {
  id: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  lastModifiedBy?: Actor;
}

export type NoteSummary = Omit<Note, 'content' | 'lastModifiedBy'>;

export interface NoteWithEtag {
  note: Note;
  etag: string;
}

/** 受け付けるフィールドだけを取り出した入力(未指定のフィールドは undefined) */
export interface NoteInput {
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_BYTES = 1024 * 1024;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;
const SNIPPET_RADIUS = 100;
const MAX_SEPARATOR_LENGTH = 10;
const DEFAULT_SEPARATOR = '\n\n';
// 条件付き書き込みが競合したときの再試行回数(If-Match を指定されていない場合のみ)
const MAX_WRITE_ATTEMPTS = 3;

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
// 無効要素だけの巨大配列で全件走査させられないよう、走査自体にも上限を設ける
const MAX_TAG_SCAN = 100;

// タグの入力サニタイゼーション: 文字列配列以外は空に、trim・空要素除去・重複排除・件数/長さ制限
export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.slice(0, MAX_TAG_SCAN)) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/**
 * リクエストボディから title・content・tags・pinned だけを取り出して検証する。
 * それ以外のフィールドは無視する(任意のフィールドが保存されないようにするため)。
 */
export function parseNoteInput(body: unknown): NoteInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ServiceError(400, 'VALIDATION_FAILED', 'Request body must be a JSON object');
  }
  const raw = body as Record<string, unknown>;
  const input: NoteInput = {};

  if (raw.title !== undefined) {
    if (typeof raw.title !== 'string') {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'title must be a string');
    }
    if (raw.title.length > MAX_TITLE_LENGTH) {
      throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', `title must be at most ${MAX_TITLE_LENGTH} characters`);
    }
    input.title = raw.title;
  }
  if (raw.content !== undefined) {
    if (typeof raw.content !== 'string') {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'content must be a string');
    }
    assertContentSize(raw.content);
    input.content = raw.content;
  }
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags) || !raw.tags.every(tag => typeof tag === 'string')) {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'tags must be an array of strings');
    }
    // 前後の空白・空要素・重複の除去と件数/長さの制限は従来どおり正規化で行う
    input.tags = sanitizeTags(raw.tags);
  }
  if (raw.pinned !== undefined) {
    if (typeof raw.pinned !== 'boolean') {
      throw new ServiceError(400, 'VALIDATION_FAILED', 'pinned must be a boolean');
    }
    input.pinned = raw.pinned;
  }
  return input;
}

function assertContentSize(content: string): void {
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    throw new ServiceError(413, 'PAYLOAD_TOO_LARGE', `content must be at most ${MAX_CONTENT_BYTES} bytes`);
  }
}

// ピン留めの切り替えだけのリクエストか(内容が変わらないので updatedAt を動かさない)
function isPinOnlyUpdate(input: NoteInput): boolean {
  const keys = Object.keys(input);
  return keys.length > 0 && keys.every(key => key === 'pinned');
}

/** S3 上のデータが壊れていても型不整合を返さないよう、読み出し時に正規化する */
function normalizeStoredNote(id: string, raw: unknown): Note {
  const data = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const note: Note = {
    id,
    title: typeof data.title === 'string' ? data.title : 'Untitled',
    content: typeof data.content === 'string' ? data.content : '',
    tags: sanitizeTags(data.tags),
    pinned: data.pinned === true,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  };
  const actor = data.lastModifiedBy as Actor | undefined;
  if (actor && (actor.type === 'user' || actor.type === 'agent')) {
    note.lastModifiedBy = actor;
  }
  return note;
}

function toSummary(note: Note): NoteSummary {
  return {
    id: note.id,
    title: note.title,
    tags: note.tags,
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

/** 一致箇所の前後 100 文字。本文に一致しなければ本文の先頭を返す */
export function makeSnippet(content: string, query: string): string {
  const index = query ? content.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (index < 0) {
    return content.length > SNIPPET_RADIUS * 2 ? `${content.slice(0, SNIPPET_RADIUS * 2)}…` : content;
  }
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(content.length, index + query.length + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${content.slice(start, end)}${end < content.length ? '…' : ''}`;
}

// ETag はダブルクォートの有無や弱い ETag の接頭辞が違っても同じものとして比べる
function sameEtag(a: string, b: string): boolean {
  const normalize = (value: string) => value.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  return normalize(a) === normalize(b);
}

const NOTE_ID_PATTERN = /^[a-zA-Z0-9-]{1,100}$/;

/**
 * ノート ID を検証する。使えない文字を取り除いて別の ID として扱うと、
 * 誤った(あるいは悪意のある)入力が別のノートを指してしまうため、形式が違えば 400 で拒否する。
 */
export function validateNoteId(noteId: string | undefined): string {
  if (!noteId) {
    throw new ServiceError(400, 'VALIDATION_FAILED', 'Note ID is required');
  }
  if (!NOTE_ID_PATTERN.test(noteId)) {
    throw new ServiceError(400, 'VALIDATION_FAILED', 'Note ID may contain only letters, digits and hyphens');
  }
  return noteId;
}

export interface SearchOptions {
  q?: string;
  tags?: string[];
  limit?: number;
  cursor?: string;
  include?: 'snippet' | 'content';
}

export interface SearchResultItem extends NoteSummary {
  snippet?: string;
  content?: string;
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(cursor: string): number {
  try {
    const offset = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')).o;
    if (Number.isInteger(offset) && offset >= 0) return offset;
  } catch {
    // 下で検証エラーにする
  }
  throw new ServiceError(400, 'VALIDATION_FAILED', 'cursor is invalid');
}

export interface NotesServiceOptions {
  now?: () => Date;
  generateId?: () => string;
}

function defaultGenerateId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** ユーザーごとのノート操作。userPrefix はオーソライザーが検証したユーザー ID から作ったもの */
export function createNotesService(storage: ObjectStorage, userPrefix: string, options: NotesServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const generateId = options.generateId ?? defaultGenerateId;
  const keyOf = (id: string) => `${userPrefix}${id}.json`;

  async function loadAll(): Promise<Note[]> {
    const keys = (await storage.listKeys(userPrefix)).filter(key => key.endsWith('.json'));
    const notes = await Promise.all(keys.map(async key => {
      const id = key.slice(userPrefix.length, -'.json'.length);
      // 別のプレフィックス配下(サブディレクトリ)のオブジェクトはノートとして扱わない
      if (!id || id.includes('/')) return null;
      const object = await storage.get(key);
      if (!object) return null;
      try {
        return normalizeStoredNote(id, JSON.parse(object.body));
      } catch {
        console.warn('Skipping unreadable note:', id);
        return null;
      }
    }));
    return notes.filter((note): note is Note => note !== null);
  }

  async function load(id: string): Promise<NoteWithEtag> {
    const object = await storage.get(keyOf(id));
    if (!object) {
      throw new ServiceError(404, 'NOTE_NOT_FOUND', 'Note not found');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(object.body);
    } catch {
      throw new Error(`Stored note is not valid JSON: ${id}`);
    }
    return { note: normalizeStoredNote(id, raw), etag: object.etag };
  }

  /**
   * 読み出し → 変更 → 条件付き書き込み。
   * ifMatch を指定されたら、その版でなければ 409。指定がなければ競合時に読み直して再試行する。
   */
  async function modify(id: string, change: (note: Note) => Note, ifMatch?: string): Promise<NoteWithEtag> {
    for (let attempt = 1; ; attempt++) {
      const current = await load(id);
      if (ifMatch !== undefined && !sameEtag(ifMatch, current.etag)) {
        throw new ServiceError(409, 'CONFLICT', 'Note has been modified. Fetch the latest version and retry.');
      }
      const updated = change(current.note);
      assertContentSize(updated.content);
      try {
        const etag = await storage.put(keyOf(id), JSON.stringify(updated), { ifMatch: current.etag });
        return { note: updated, etag };
      } catch (error) {
        if (!(error instanceof PreconditionFailedError)) throw error;
        if (ifMatch !== undefined || attempt >= MAX_WRITE_ATTEMPTS) {
          throw new ServiceError(409, 'CONFLICT', 'Note has been modified. Fetch the latest version and retry.');
        }
      }
    }
  }

  return {
    /** 現行の GET /notes と同じサマリ一覧(並びは S3 のキー順) */
    async listSummaries(): Promise<NoteSummary[]> {
      return (await loadAll()).map(toSummary);
    },

    /** 検索・絞り込み・ページング。並びは updatedAt の降順 */
    async search(options: SearchOptions): Promise<{ notes: SearchResultItem[]; nextCursor: string | null }> {
      const limit = options.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ServiceError(400, 'VALIDATION_FAILED', `limit must be an integer between 1 and ${MAX_LIMIT}`);
      }
      const offset = options.cursor ? decodeCursor(options.cursor) : 0;
      const q = (options.q ?? '').trim().toLowerCase();
      const tags = (options.tags ?? []).map(tag => tag.trim()).filter(Boolean);

      const matched = (await loadAll())
        .filter(note =>
          !q || note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q)
        )
        .filter(note => tags.every(tag => note.tags.includes(tag)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

      const page = matched.slice(offset, offset + limit).map(note => {
        const item: SearchResultItem = toSummary(note);
        if (options.include === 'snippet') item.snippet = makeSnippet(note.content, q);
        if (options.include === 'content') item.content = note.content;
        return item;
      });
      const nextOffset = offset + limit;
      return { notes: page, nextCursor: nextOffset < matched.length ? encodeCursor(nextOffset) : null };
    },

    async listTags(): Promise<{ name: string; count: number }[]> {
      const counts = new Map<string, number>();
      for (const note of await loadAll()) {
        for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja'));
    },

    async getNote(id: string): Promise<NoteWithEtag> {
      return load(id);
    },

    async createNote(input: NoteInput, actor: Actor): Promise<NoteWithEtag> {
      const id = generateId();
      const timestamp = now().toISOString();
      const note: Note = {
        id,
        title: input.title || 'Untitled',
        content: input.content ?? '',
        tags: input.tags ?? [],
        pinned: input.pinned ?? false,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastModifiedBy: actor,
      };
      // ID の衝突で既存のノートを上書きしない
      const etag = await storage.put(keyOf(id), JSON.stringify(note), { ifNoneMatch: '*' });
      return { note, etag };
    },

    async updateNote(id: string, input: NoteInput, actor: Actor, ifMatch?: string): Promise<NoteWithEtag> {
      const pinOnly = isPinOnlyUpdate(input);
      return modify(id, note => ({
        ...note,
        ...input,
        id: note.id,
        createdAt: note.createdAt,
        // ピン留めの切り替えだけでは内容が変わらないので、更新日時と更新者を動かさない
        updatedAt: pinOnly ? note.updatedAt : now().toISOString(),
        lastModifiedBy: pinOnly ? note.lastModifiedBy : actor,
      }), ifMatch);
    },

    async appendToNote(id: string, text: unknown, separator: unknown, actor: Actor): Promise<NoteWithEtag> {
      if (typeof text !== 'string' || text.length === 0) {
        throw new ServiceError(400, 'VALIDATION_FAILED', 'text must be a non-empty string');
      }
      if (separator !== undefined && (typeof separator !== 'string' || separator.length > MAX_SEPARATOR_LENGTH)) {
        throw new ServiceError(400, 'VALIDATION_FAILED', `separator must be a string of at most ${MAX_SEPARATOR_LENGTH} characters`);
      }
      assertContentSize(text);
      const sep = (separator as string | undefined) ?? DEFAULT_SEPARATOR;
      return modify(id, note => ({
        ...note,
        // 空のノートには区切りを入れない
        content: note.content ? `${note.content}${sep}${text}` : text,
        updatedAt: now().toISOString(),
        lastModifiedBy: actor,
      }));
    },

    async deleteNote(id: string): Promise<void> {
      await storage.delete(keyOf(id));
    },
  };
}

export type NotesService = ReturnType<typeof createNotesService>;
