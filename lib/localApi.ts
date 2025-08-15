import { Note, NotesListResponse, NoteResponse } from './api';

const STORAGE_PREFIX = 'simplenotebook_';
const NOTES_KEY = `${STORAGE_PREFIX}notes`;

function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
}