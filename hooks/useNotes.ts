'use client';

import { useState, useEffect } from 'react';
import { apiClient, Note } from '../lib/api';

export function useNotes() {
  const [notes, setNotes] = useState<Omit<Note, 'content'>[]>([]);
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
      setNotes(prev => [...prev, {
        id: response.note.id,
        title: response.note.title,
        createdAt: response.note.createdAt,
        updatedAt: response.note.updatedAt,
      }]);
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
        note.id === id 
          ? {
              id: response.note.id,
              title: response.note.title,
              createdAt: response.note.createdAt,
              updatedAt: response.note.updatedAt,
            }
          : note
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

  // Remove automatic fetching on mount - let the calling component decide when to fetch

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