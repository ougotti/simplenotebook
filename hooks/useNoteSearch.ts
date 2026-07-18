'use client';

import { useState, useEffect, useMemo } from 'react';
import { Note } from '../lib/api';

type NoteSummary = Omit<Note, 'content'>;

/**
 * ノート一覧のクライアントサイド検索。
 * 一覧 API は content を返さないため、検索開始時に本文を取得してキャッシュする。
 * キャッシュキーに updatedAt を含めることで、更新されたノートは自動的に再取得される。
 */
export function useNoteSearch(
  notes: NoteSummary[],
  getNote: (id: string) => Promise<Note | null>
) {
  const [query, setQuery] = useState('');
  const [contents, setContents] = useState<Record<string, string>>({});

  const cacheKey = (note: NoteSummary) => `${note.id}:${note.updatedAt}`;

  useEffect(() => {
    if (!query.trim()) return;
    const missing = notes.filter(note => !(cacheKey(note) in contents));
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async note => {
          const full = await getNote(note.id);
          return [cacheKey(note), full?.content ?? ''] as const;
        })
      );
      if (!cancelled) {
        setContents(prev => ({ ...prev, ...Object.fromEntries(entries) }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, notes]);

  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(note =>
      note.title.toLowerCase().includes(q) ||
      (contents[cacheKey(note)] ?? '').toLowerCase().includes(q)
    );
  }, [query, notes, contents]);

  return { query, setQuery, filteredNotes, isSearching: query.trim().length > 0 };
}
