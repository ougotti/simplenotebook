'use client'
import { useState, FormEvent } from 'react'
import { useUserSettings } from '../../hooks/useUserSettings'
import { getUserDisplayName, getUserEmail } from '../../utils/userDisplay'
import { useAuth } from '../../hooks/useAuth'

export default function SettingsPage() {
  const { user, isLocal } = useAuth()
  const { settings, loading, error, saving, updateSettings } = useUserSettings()
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [hasLoadedSettings, setHasLoadedSettings] = useState(false)

  // 設定が読み込まれたらフォームを初期化
  if (settings && !hasLoadedSettings) {
    setDisplayName(settings.displayName || '')
    setHasLoadedSettings(true)
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')

    try {
      await updateSettings({
        displayName: displayName.trim() || undefined,
      })
      setMessage('設定を保存しました！')
    } catch (err) {
      setMessage('保存に失敗しました。もう一度お試しください。')
    }
  }

  const currentDisplayName = getUserDisplayName(user, settings)
  const userEmail = getUserEmail(user)

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">設定を読み込み中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">ユーザー設定</h1>
        <p className="text-gray-600">
          アカウント情報と表示設定を管理します
        </p>
        {isLocal && (
          <div className="mt-2 p-2 bg-orange-50 border-l-4 border-orange-400 text-orange-700">
            <p className="text-sm">
              開発モード - 設定はローカルストレージに保存されます
            </p>
          </div>
        )}
      </div>

      {/* Current User Info */}
      <div className="bg-gray-50 rounded-lg p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">現在の表示情報</h2>
        <div className="space-y-2">
          <div>
            <span className="text-sm text-gray-500">表示名:</span>
            <span className="ml-2 font-medium">{currentDisplayName}</span>
          </div>
          {userEmail && (
            <div>
              <span className="text-sm text-gray-500">メールアドレス:</span>
              <span className="ml-2">{userEmail}</span>
            </div>
          )}
        </div>
      </div>

      {/* Settings Form */}
      <div className="bg-white rounded-lg border p-6">
        <h2 className="text-lg font-semibold mb-6">表示設定</h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-400 text-red-700">
            <p className="text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-2">
              カスタム表示名
            </label>
            <input
              id="displayName"
              type="text"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="表示したい名前を入力（空白の場合はアカウント名を使用）"
              maxLength={50}
              disabled={saving}
            />
            <p className="mt-1 text-xs text-gray-500">
              ここで設定した名前がアプリ内で表示されます。空白にするとアカウント名が使用されます。
            </p>
          </div>

          <div className="flex justify-between items-center">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors"
            >
              {saving ? '保存中...' : '設定を保存'}
            </button>
            
            <a
              href="/simplenotebook/notes/new"
              className="text-sm text-blue-500 hover:text-blue-700"
            >
              ノート一覧に戻る
            </a>
          </div>

          {message && (
            <div className={`p-3 rounded-md text-sm ${
              message.includes('失敗') 
                ? 'bg-red-50 text-red-700 border border-red-200' 
                : 'bg-green-50 text-green-700 border border-green-200'
            }`}>
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}