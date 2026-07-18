'use client';

import { useState, KeyboardEvent } from 'react';

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

export default function TagInput({ tags, onChange, disabled = false }: TagInputProps) {
  const [input, setInput] = useState('');

  function addTag() {
    const tag = input.trim();
    setInput('');
    if (!tag || tags.includes(tag)) return;
    onChange([...tags, tag]);
  }

  function removeTag(tag: string) {
    onChange(tags.filter(t => t !== tag));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // IME 変換確定の Enter でタグ追加されないよう composition 中は無視する
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && input === '' && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 w-full border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-800"
      data-testid="tag-input"
    >
      {tags.map(tag => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full px-2 py-0.5"
          data-testid="tag-chip"
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            aria-label={`タグ「${tag}」を削除`}
            className="hover:text-blue-600 dark:hover:text-blue-100"
            disabled={disabled}
          >
            ✕
          </button>
        </span>
      ))}
      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={tags.length === 0 ? 'タグを追加 (Enter で確定)' : ''}
        aria-label="タグを追加"
        className="flex-1 min-w-24 text-sm bg-transparent outline-none"
        disabled={disabled}
      />
    </div>
  );
}
