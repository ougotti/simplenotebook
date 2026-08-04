'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

interface MarkdownPreviewProps {
  content: string;
}

export default function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div
      className="markdown-preview w-full h-64 overflow-y-auto border dark:border-gray-600 rounded p-3 bg-white dark:bg-gray-800 text-sm"
      data-testid="markdown-preview"
    >
      {content.trim() ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
      ) : (
        <p className="text-gray-500 dark:text-gray-400">プレビューする内容がありません</p>
      )}
    </div>
  );
}
