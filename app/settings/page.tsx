'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiClient, UserSettings } from '../../lib/api';
import SettingsModal from '../../components/SettingsModal';
import UserDisplay from '../../components/UserDisplay';

export default function SettingsPage() {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function loadUserSettings() {
      try {
        const settings = await apiClient.getUserSettings();
        setUserSettings(settings);
      } catch (err: any) {
        console.error('設定読み込みエラー:', err);
        if (err.message?.includes('API request failed: 404') || err.message?.includes('Settings not found')) {
          setError('設定が見つかりません。初期設定を行ってください。');
        } else {
          setError('設定の読み込みに失敗しました。');
        }
      } finally {
        setLoading(false);
      }
    }

    loadUserSettings();
  }, []);

  const handleSaveSettings = async (settings: { displayName: string }) => {
    try {
      const updatedSettings = await apiClient.updateUserSettings(settings);
      setUserSettings(updatedSettings);
      setShowSettingsModal(false);
      setError(null);
      console.log('設定が正常に更新されました');
    } catch (error) {
      console.error('設定保存エラー:', error);
      throw error; // モーダルでエラーハンドリング
    }
  };

  const handleBackToNotes = () => {
    router.push('/notes/new');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">設定を読み込んでいます...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-3xl font-bold text-gray-900">ユーザー設定</h1>
          <button
            onClick={handleBackToNotes}
            className="text-sm text-blue-600 hover:text-blue-800 underline"
          >
            ノートページに戻る
          </button>
        </div>
        <p className="text-gray-600">
          あなたの設定を管理できます。
        </p>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 rounded-md p-6 mb-6">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">エラー</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>{error}</p>
              </div>
              <div className="mt-4">
                <button
                  onClick={() => setShowSettingsModal(true)}
                  className="bg-red-600 text-white px-4 py-2 text-sm rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                >
                  初期設定を行う
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        userSettings && (
          <div className="bg-white shadow rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">基本情報</h2>
            </div>
            <div className="px-6 py-4 space-y-6">
              {/* 表示名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  表示名
                </label>
                <div className="bg-gray-50 rounded-md px-3 py-2 min-h-[2.5rem] flex items-center">
                  <UserDisplay />
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  他のユーザーに表示される名前です。
                </p>
              </div>

              {/* 作成日時 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  アカウント作成日時
                </label>
                <div className="bg-gray-50 rounded-md px-3 py-2">
                  <span className="text-sm text-gray-900">
                    {new Date(userSettings.createdAt).toLocaleString('ja-JP')}
                  </span>
                </div>
              </div>

              {/* 最終更新日時 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  最終更新日時
                </label>
                <div className="bg-gray-50 rounded-md px-3 py-2">
                  <span className="text-sm text-gray-900">
                    {new Date(userSettings.updatedAt).toLocaleString('ja-JP')}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end">
              <button
                onClick={() => setShowSettingsModal(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                設定を変更
              </button>
            </div>
          </div>
        )
      )}

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onSave={handleSaveSettings}
        onCancel={() => setShowSettingsModal(false)}
        isFirstTime={false}
        title="設定変更"
        initialDisplayName={userSettings?.displayName || ''}
      />
    </div>
  );
}