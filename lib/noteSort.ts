import { NoteSummary } from './api';

export type NoteSortKey = 'updatedAt' | 'createdAt' | 'title';

export const NOTE_SORT_OPTIONS: { value: NoteSortKey; label: string }[] = [
  { value: 'updatedAt', label: '更新日時順' },
  { value: 'createdAt', label: '作成日時順' },
  { value: 'title', label: 'タイトル順' },
];

export const DEFAULT_NOTE_SORT: NoteSortKey = 'updatedAt';

export function isNoteSortKey(value: unknown): value is NoteSortKey {
  return NOTE_SORT_OPTIONS.some(option => option.value === value);
}

function compareBy(key: NoteSortKey, a: NoteSummary, b: NoteSummary): number {
  if (key === 'title') {
    return a.title.localeCompare(b.title, 'ja');
  }
  // 日時は新しい順。ISO 8601 文字列なので文字列比較で足りる
  return b[key].localeCompare(a[key]);
}

/** ピン留めノートを先頭に、その中と残りをそれぞれ指定キーで並べる(元配列は変更しない) */
export function sortNotes(notes: NoteSummary[], key: NoteSortKey): NoteSummary[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return compareBy(key, a, b);
  });
}
