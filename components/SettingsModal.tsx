'use client';

import { useState, useEffect, useRef } from 'react';
import { UserSettings } from '../lib/api';
import { validateDisplayName } from '../lib/settings';

interface SettingsModalProps {
  isOpen: boolean;
  onSave: (settings: { displayName: string }) => Promise<void>;
  onCancel?: () => void;
  isFirstTime?: boolean;
  title?: string;
  initialDisplayName?: string;
}

export default function SettingsModal({
  isOpen,
  onSave,
  onCancel,
  isFirstTime = false,
  title = '設定',
  initialDisplayName = '',
}: SettingsModalProps) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // 初回オープン時にフォーカス設定
  useEffect(() => {
    if (isOpen) {
      setDisplayName(initialDisplayName);
      setErrors([]);
      // 少し遅延させてフォーカス設定
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 100);
    }
  }, [isOpen, initialDisplayName]);

  // フォーカストラップ実装
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll(
          'input, button, textarea, select, [tabindex]:not([tabindex="-1"])'
        );
        const focusableArray = Array.from(focusableElements || []) as HTMLElement[];
        
        if (focusableArray.length === 0) return;

        const firstElement = focusableArray[0];
        const lastElement = focusableArray[focusableArray.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }

      // 初回設定モード以外でのESCキーでの閉じ処理を無効化
      if (e.key === 'Escape' && !isFirstTime && onCancel) {
        // 現在は無効化されているが、通常モードでは有効にする可能性がある
        // onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isFirstTime, onCancel]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    
    const validation = validateDisplayName(displayName);
    if (!validation.isValid) {
      setErrors([validation.error!]);
      return;
    }

    setIsSubmitting(true);
    try {
      await onSave({ displayName: validation.displayName! });
    } catch (error) {
      console.error('設定保存エラー:', error);
      setErrors(['設定の保存に失敗しました。もう一度お試しください。']);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    if (isFirstTime) {
      // 初回設定モードでは閉じることはできない
      return;
    }
    onCancel?.();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    // 初回設定モードでは背景クリックで閉じることはできない
    if (isFirstTime) {
      return;
    }
    if (e.target === e.currentTarget) {
      onCancel?.();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50 ${
        isFirstTime ? 'cursor-default' : 'cursor-pointer'
      }`}
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
    >
      <div
        ref={modalRef}
        className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 id="modal-title" className="text-xl font-semibold text-gray-900">
            {title}
          </h2>
          {isFirstTime && (
            <p id="modal-description" className="mt-2 text-sm text-gray-600">
              初回設定を行ってください。この設定は後から変更できます。
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            {errors.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <ul className="text-sm text-red-800" role="alert">
                      {errors.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
                表示名 <span className="text-red-500">*</span>
              </label>
              <input
                ref={firstInputRef}
                type="text"
                id="displayName"
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="山田太郎"
                maxLength={100}
                disabled={isSubmitting}
                aria-describedby="displayName-help"
              />
              <p id="displayName-help" className="mt-1 text-xs text-gray-500">
                100文字以内で入力してください。絵文字や全角文字も使用できます。
              </p>
            </div>
          </div>

          <div className="px-6 py-4 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
            {!isFirstTime && onCancel && (
              <button
                ref={closeButtonRef}
                type="button"
                onClick={handleCancel}
                disabled={isSubmitting}
                className="mt-3 sm:mt-0 w-full sm:w-auto px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                キャンセル
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting || !displayName.trim()}
              className="w-full sm:w-auto px-4 py-2 bg-blue-600 text-white rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}