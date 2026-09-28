import { getConfig, isLocalMode } from './config';
import { LocalApiClient } from './localApi';

export interface Note {
  id: string;
  title: string;
  content: string;
  /** 旧データにはフィールド自体が存在しないため optional (タグなしは [] 扱い) */
  tags?: string[];
  /** 旧データにはフィールド自体が存在しないため optional (未指定は未ピン扱い) */
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

/** 一覧表示用サマリ。tags は string[]、pinned は boolean に正規化済みで保持する */
export type NoteSummary = Omit<Note, 'content' | 'tags' | 'pinned'> & { tags: string[]; pinned: boolean };

export interface NotesListResponse {
  notes: NoteSummary[];
}

export interface NoteResponse {
  note: Note;
}

/** PAT に付与できるスコープ(notes:delete は PAT に付与できない) */
export type AccessTokenScope = 'notes:read' | 'notes:write';

/** トークン管理 API が返すトークン情報(秘密情報は含まない) */
export interface AccessToken {
  tokenId: string;
  kind: string;
  name: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface CreateAccessTokenInput {
  name: string;
  scopes: AccessTokenScope[];
  expiresInDays: number;
}

export interface CreateAccessTokenResponse {
  /** 平文のトークン。このレスポンスでしか取得できない */
  token: string;
  tokenInfo: AccessToken;
}

/** API のエラー。message は従来どおり "API request failed: <status> ..." の形で、サーバーの説明は serverMessage に入る */
export class ApiError extends Error {
  constructor(message: string, public status: number, public serverMessage?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

class ApiClient {
  private baseUrl: string = '';
  private accessToken: string = '';
  private localClient: LocalApiClient = new LocalApiClient();
  private _isLocalMode: boolean | null = null;

  async initialize() {
    const config = await getConfig();
    this.baseUrl = config.apiBaseUrl;
    this._isLocalMode = isLocalMode(config);
  }

  private async getLocalMode(): Promise<boolean> {
    if (this._isLocalMode === null) {
      await this.initialize();
    }
    return this._isLocalMode!;
  }

  /**
   * Sets the bearer token for API authentication.
   * Supports both ID tokens (for Cognito User Pool Authorizers) and access tokens.
   * @param token - JWT token string (ID token or access token)
   */
  setBearerToken(token: string) {
    this.accessToken = token;
  }

  /**
   * @deprecated Use setBearerToken instead. Maintained for backward compatibility.
   * @param token - JWT token string
   */
  setAccessToken(token: string) {
    this.setBearerToken(token);
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) {
      await this.initialize();
    }

    const url = `${this.baseUrl.replace(/\/+$/, '')}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.accessToken}`,
      ...options.headers,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized - please sign in again');
      }
      let serverMessage: string | undefined;
      try {
        const body = await response.json();
        if (typeof body?.message === 'string') serverMessage = body.message;
      } catch {
        // 本文が JSON でなければ説明なし
      }
      throw new ApiError(`API request failed: ${response.status} ${response.statusText}`, response.status, serverMessage);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  async listNotes(): Promise<NotesListResponse> {
    if (await this.getLocalMode()) {
      return this.localClient.listNotes();
    }
    return this.request<NotesListResponse>('/notes');
  }

  async getNote(id: string): Promise<NoteResponse> {
    if (await this.getLocalMode()) {
      return this.localClient.getNote(id);
    }
    return this.request<NoteResponse>(`/notes/${encodeURIComponent(id)}`);
  }

  async createNote(note: Partial<Note>): Promise<NoteResponse> {
    if (await this.getLocalMode()) {
      return this.localClient.createNote(note);
    }
    return this.request<NoteResponse>('/notes', {
      method: 'POST',
      body: JSON.stringify(note),
    });
  }

  async updateNote(id: string, note: Partial<Note>): Promise<NoteResponse> {
    if (await this.getLocalMode()) {
      return this.localClient.updateNote(id, note);
    }
    return this.request<NoteResponse>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(note),
    });
  }

  async deleteNote(id: string): Promise<void> {
    if (await this.getLocalMode()) {
      return this.localClient.deleteNote(id);
    }
    await this.request(`/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getUserSettings(): Promise<UserSettings> {
    if (await this.getLocalMode()) {
      // ローカルモード用の設定取得
      const settings = localStorage.getItem('userSettings');
      if (settings) {
        return JSON.parse(settings);
      }
      // 設定が存在しない場合は404エラーを模擬
      throw new Error('Settings not found');
    }
    
    try {
      return await this.request<UserSettings>('/users/me/settings');
    } catch (error: any) {
      // API呼び出しエラーをそのまま再スロー
      throw error;
    }
  }

  async updateUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
    if (await this.getLocalMode()) {
      // ローカルモード用の設定更新
      const now = new Date().toISOString();
      const existingSettings = localStorage.getItem('userSettings');
      const existing = existingSettings ? JSON.parse(existingSettings) : null;
      
      const updatedSettings: UserSettings = {
        displayName: settings.displayName || '',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      
      localStorage.setItem('userSettings', JSON.stringify(updatedSettings));
      return updatedSettings;
    }
    
    return this.request<UserSettings>('/users/me/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async listAccessTokens(): Promise<AccessToken[]> {
    if (await this.getLocalMode()) {
      return this.localClient.listAccessTokens();
    }
    const response = await this.request<{ tokens: AccessToken[] }>('/tokens');
    return response.tokens;
  }

  async createAccessToken(input: CreateAccessTokenInput): Promise<CreateAccessTokenResponse> {
    if (await this.getLocalMode()) {
      return this.localClient.createAccessToken(input);
    }
    return this.request<CreateAccessTokenResponse>('/tokens', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async revokeAccessToken(tokenId: string): Promise<void> {
    if (await this.getLocalMode()) {
      return this.localClient.revokeAccessToken(tokenId);
    }
    await this.request(`/tokens/${encodeURIComponent(tokenId)}`, {
      method: 'DELETE',
    });
  }

  /** 接続例に表示する API の URL(末尾のスラッシュなし) */
  async getApiBaseUrl(): Promise<string> {
    if (!this.baseUrl) {
      await this.initialize();
    }
    return this.baseUrl.replace(/\/+$/, '');
  }

  async isLocal(): Promise<boolean> {
    return this.getLocalMode();
  }
}

export const apiClient = new ApiClient();