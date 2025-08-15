import { getConfig, isLocalMode } from './config';
import { LocalApiClient } from './localApi';

export interface Note {
  id: string;
  title: string;
  content: string;
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

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) {
      await this.initialize();
    }

    const url = `${this.baseUrl.replace(/\/$/, '')}${endpoint}`;
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

  async isLocal(): Promise<boolean> {
    return this.getLocalMode();
  }
}

export const apiClient = new ApiClient();