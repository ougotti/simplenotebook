'use client';

import { useTheme } from '../hooks/useTheme';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      title={isDark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
      className="text-lg leading-none p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"
      data-testid="theme-toggle"
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
}
