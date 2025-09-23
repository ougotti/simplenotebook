import { getConfig, isLocalMode } from './config';
import { LocalApiClient } from './localApi';

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotesListResponse {
  notes: Omit<Note, 'content'>[];
}

export interface NoteResponse {
  note: Note;
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
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
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

  async isLocal(): Promise<boolean> {
    return this.getLocalMode();
  }
}

export const apiClient = new ApiClient();