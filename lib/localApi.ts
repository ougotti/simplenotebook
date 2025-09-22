import { Note, NotesListResponse, NoteResponse } from './api';
import { UserSettings, UserSettingsResponse, UpdateUserSettingsRequest } from '../types/userSettings';

const STORAGE_PREFIX = 'simplenotebook_';
const NOTES_KEY = `${STORAGE_PREFIX}notes`;
const USER_SETTINGS_KEY = `${STORAGE_PREFIX}user_settings`;

function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

function getStoredUserSettings(): UserSettings | null {
  try {
    const stored = localStorage.getItem(USER_SETTINGS_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function setStoredUserSettings(settings: UserSettings): void {
  localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(settings));
}

export class LocalApiClient {
  async listNotes(): Promise<NotesListResponse> {
    const notes = getStoredNotes();
    return {
      notes: notes.map(note => ({
        id: note.id,
        title: note.title,
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
      updatedAt: new Date().toISOString(),
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

  async getUserSettings(): Promise<UserSettingsResponse> {
    const stored = getStoredUserSettings();
    
    // デフォルト設定を返す（初回アクセス時）
    if (!stored) {
      const defaultSettings: UserSettings = {
        updatedAt: new Date().toISOString(),
      };
      return { settings: defaultSettings };
    }
    
    return { settings: stored };
  }

  async updateUserSettings(updateRequest: UpdateUserSettingsRequest): Promise<UserSettingsResponse> {
    const current = getStoredUserSettings();
    
    const updatedSettings: UserSettings = {
      ...current,
      displayName: updateRequest.displayName !== undefined ? updateRequest.displayName : current?.displayName,
      preferences: updateRequest.preferences !== undefined ? updateRequest.preferences : current?.preferences,
      updatedAt: new Date().toISOString(),
    };
    
    setStoredUserSettings(updatedSettings);
    
    return { settings: updatedSettings };
  }
}