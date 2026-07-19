'use client';

import { useState, useEffect } from 'react';
import { apiClient, Note } from '../lib/api';

export type NoteSummary = Omit<Note, 'content'>;

// API 応答から一覧用サマリを作る。content だけを除外し、それ以外のフィールドは
// 自動的に引き継ぐことで、Note にフィールドが増えたときの反映漏れを防ぐ
// (スプリント2で tags の落とし漏れが実際に発生したための対策)。
function toNoteSummary(note: Note): NoteSummary {
  const { content, ...summary } = note;
  return { ...summary, tags: note.tags ?? [] };
}

export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.listNotes();
      setNotes(response.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch notes');
    } finally {
      setLoading(false);
    }
  };

  const createNote = async (noteData: Partial<Note>) => {
    setError(null);
    try {
      const response = await apiClient.createNote(noteData);
      setNotes(prev => [...prev, toNoteSummary(response.note)]);
      return response.note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create note');
      throw err;
    }
  };

  const updateNote = async (id: string, noteData: Partial<Note>) => {
    setError(null);
    try {
      const response = await apiClient.updateNote(id, noteData);
      setNotes(prev => prev.map(note =>
        note.id === id ? toNoteSummary(response.note) : note
      ));
      return response.note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update note');
      throw err;
    }
  };

  const deleteNote = async (id: string) => {
    setError(null);
    try {
      await apiClient.deleteNote(id);
      setNotes(prev => prev.filter(note => note.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete note');
      throw err;
    }
  };

  const getNote = async (id: string): Promise<Note | null> => {
    setError(null);
    try {
      const response = await apiClient.getNote(id);
      return response.note;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get note');
      return null;
    }
  };

  useEffect(() => {
    fetchNotes();
  }, []);

  return {
    notes,
    loading,
    error,
    fetchNotes,
    createNote,
    updateNote,
    deleteNote,
    getNote,
  };
}