import type {
  Note,
  NotesListResponse,
  NoteResponse,
  AccessToken,
  CreateAccessTokenInput,
  CreateAccessTokenResponse,
} from './api';

const STORAGE_PREFIX = 'simplenotebook_';
const NOTES_KEY = `${STORAGE_PREFIX}notes`;
const TOKENS_KEY = `${STORAGE_PREFIX}access_tokens`;

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DAY_MS = 24 * 60 * 60 * 1000;

function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('');
}

function getStoredTokens(): AccessToken[] {
  try {
    const stored = localStorage.getItem(TOKENS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredTokens(tokens: AccessToken[]): void {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
}

function withStatus(token: AccessToken): AccessToken {
  const status = token.revokedAt
    ? 'revoked'
    : new Date(token.expiresAt).getTime() > Date.now() ? 'active' : 'expired';
  return { ...token, status };
}

function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isPinOnlyUpdate(noteData: Partial<Note>): boolean {
  const keys = Object.keys(noteData);
  return keys.length > 0 && keys.every(key => key === 'pinned');
}

function getStoredNotes(): Note[] {
  try {
    const stored = localStorage.getItem(NOTES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function setStoredNotes(notes: Note[]): void {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

export class LocalApiClient {
  // 開発モード用の模擬実装。形式だけ本物に合わせたトークンを返し、どこでも使えない
  async listAccessTokens(): Promise<AccessToken[]> {
    return getStoredTokens().map(withStatus);
  }

  async createAccessToken(input: CreateAccessTokenInput): Promise<CreateAccessTokenResponse> {
    const tokens = getStoredTokens();
    const now = new Date();
    const tokenId = randomString(16, CROCKFORD_BASE32);
    const tokenInfo: AccessToken = withStatus({
      tokenId,
      kind: 'pat',
      name: input.name.trim(),
      scopes: [...input.scopes],
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + input.expiresInDays * DAY_MS).toISOString(),
      lastUsedAt: null,
      revokedAt: null,
      status: 'active',
    });
    setStoredTokens([tokenInfo, ...tokens]);
    const secret = randomString(43, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_');
    return { token: `snb_local_${tokenId}_${secret}`, tokenInfo };
  }

  async revokeAccessToken(tokenId: string): Promise<void> {
    setStoredTokens(
      getStoredTokens().map(token =>
        token.tokenId === tokenId && !token.revokedAt ? { ...token, revokedAt: new Date().toISOString() } : token
      )
    );
  }

  async listNotes(): Promise<NotesListResponse> {
    const notes = getStoredNotes();
    return {
      notes: notes.map(note => ({
        id: note.id,
        title: note.title,
        tags: note.tags ?? [],
        pinned: note.pinned === true,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      })),
    };
  }

  async getNote(id: string): Promise<NoteResponse> {
    const notes = getStoredNotes();
    const note = notes.find(n => n.id === id);
    
    if (!note) {
      throw new Error('Note not found');
    }
    
    return { note };
  }

  async createNote(noteData: Partial<Note>): Promise<NoteResponse> {
    const notes = getStoredNotes();
    const now = new Date().toISOString();
    
    const newNote: Note = {
      id: generateNoteId(),
      title: noteData.title || 'Untitled',
      content: noteData.content || '',
      tags: noteData.tags ?? [],
      pinned: noteData.pinned === true,
      createdAt: now,
      updatedAt: now,
    };
    
    notes.push(newNote);
    setStoredNotes(notes);
    
    return { note: newNote };
  }

  async updateNote(id: string, noteData: Partial<Note>): Promise<NoteResponse> {
    const notes = getStoredNotes();
    const noteIndex = notes.findIndex(n => n.id === id);
    
    if (noteIndex === -1) {
      throw new Error('Note not found');
    }
    
    const existingNote = notes[noteIndex];
    const updatedNote: Note = {
      ...existingNote,
      title: noteData.title !== undefined ? noteData.title : existingNote.title,
      content: noteData.content !== undefined ? noteData.content : existingNote.content,
      tags: noteData.tags !== undefined ? noteData.tags : existingNote.tags ?? [],
      pinned: noteData.pinned !== undefined ? noteData.pinned === true : existingNote.pinned === true,
      // ピン留めの切り替えだけでは内容が変わらないため、更新日時(並び順)を動かさない
      updatedAt: isPinOnlyUpdate(noteData) ? existingNote.updatedAt : new Date().toISOString(),
    };
    
    notes[noteIndex] = updatedNote;
    setStoredNotes(notes);
    
    return { note: updatedNote };
  }

  async deleteNote(id: string): Promise<void> {
    const notes = getStoredNotes();
    const filteredNotes = notes.filter(n => n.id !== id);
    setStoredNotes(filteredNotes);
  }
}