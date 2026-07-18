'use client';

import { useState, useEffect, useMemo } from 'react';
import { Note } from '../lib/api';

type NoteSummary = Omit<Note, 'content'>;

// 本文取得の同時実行数の上限。ノート数が多い場合に一括 Promise.all で
// リクエストが膨らむのを避けるため、この件数ずつ区切って順に取得する。
const FETCH_CHUNK_SIZE = 5;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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
    const q = query.trim().toLowerCase();
    if (!q) return;

    // タイトルで既に一致しているノートは本文取得の対象から除く
    const missing = notes.filter(
      note => !note.title.toLowerCase().includes(q) && !(cacheKey(note) in contents)
    );
    if (missing.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const batch of chunk(missing, FETCH_CHUNK_SIZE)) {
        if (cancelled) return;
        const entries = await Promise.all(
          batch.map(async note => {
            const full = await getNote(note.id);
            return [cacheKey(note), full?.content ?? ''] as const;
          })
        );
        if (!cancelled) {
          setContents(prev => ({ ...prev, ...Object.fromEntries(entries) }));
        }
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
