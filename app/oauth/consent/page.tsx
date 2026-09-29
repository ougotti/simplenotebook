'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiClient, ApiError, OAuthAuthorizationRequest } from '../../../lib/api'

const SCOPE_LABELS: Record<string, { label: string; description: string }> = {
  'notes:read': { label: '読み取り', description: 'ノートの一覧・検索・本文の取得' },
  'notes:write': { label: '書き込み', description: 'ノートの作成・更新・追記' },
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.serverMessage) return err.serverMessage
  return fallback
}

/**
 * OAuth の同意画面。Claude.ai などのコネクタが /oauth/authorize からここへリダイレクトしてくる。
 * ログイン済みの本人が内容を確認して許可すると、接続元のアプリへ認可コード付きで戻る。
 */
function ConsentContent() {
  const searchParams = useSearchParams()
  const requestId = searchParams?.get('req') ?? ''
  const [request, setRequest] = useState<OAuthAuthorizationRequest | null>(null)
  const [scopes, setScopes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  useEffect(() => {
    if (!requestId) {
      setError('接続リクエストが指定されていません。接続元のアプリからもう一度やり直してください。')
      setLoading(false)
      return
    }
    apiClient.getOAuthRequest(requestId)
      .then(result => {
        setRequest(result)
        setScopes(result.scopes)
      })
      .catch(err => setError(errorMessage(err, '接続リクエストを読み込めませんでした。期限切れの可能性があります。接続元のアプリからもう一度やり直してください。')))
      .finally(() => setLoading(false))
  }, [requestId])

  function toggleScope(scope: string) {
    setScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]))
  }

  async function decide(approve: boolean) {
    if (!request) return
    if (approve && scopes.length === 0) {
      setError('許可する権限を 1 つ以上選んでください。')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const { redirectUrl } = await apiClient.decideOAuthRequest(request.requestId, approve, approve ? scopes : undefined)
      setRedirecting(true)
      window.location.assign(redirectUrl)
    } catch (err) {
      setError(errorMessage(err, '処理に失敗しました。接続元のアプリからもう一度やり直してください。'))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="text-center text-gray-600 dark:text-gray-400">接続リクエストを読み込んでいます...</p>
  }

  if (redirecting) {
    return <p className="text-center text-gray-600 dark:text-gray-400" data-testid="consent-redirecting">接続元のアプリに戻っています...</p>
  }

  if (!request) {
    return (
      <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 rounded-md p-6" role="alert" data-testid="consent-error">
        <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 shadow rounded-lg" data-testid="consent">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-lg font-medium text-gray-900 dark:text-gray-100">外部アプリとの接続</h1>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold" data-testid="consent-client-name">{request.clientName}</span>
          {' '}が、あなたの権限で SimpleNotebook のノートにアクセスすることを求めています。
        </p>
      </div>

      <div className="px-6 py-4 space-y-4">
        <div>
          <p className="text-sm text-gray-700 dark:text-gray-300">許可したあとの戻り先</p>
          <p className="mt-1 font-mono text-sm bg-gray-50 dark:bg-gray-900 rounded px-2 py-1 break-all" data-testid="consent-redirect-host">
            {request.redirectHost}
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            自分で接続を始めたアプリで、戻り先に心当たりがある場合だけ許可してください。
          </p>
        </div>

        <fieldset>
          <legend className="text-sm text-gray-700 dark:text-gray-300 mb-1">許可する権限</legend>
          <div className="space-y-1">
            {request.scopes.map(scope => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={() => toggleScope(scope)}
                  disabled={submitting}
                />
                <span className="text-gray-900 dark:text-gray-100">{SCOPE_LABELS[scope]?.label ?? scope}</span>
                <span className="text-gray-500 dark:text-gray-400">— {SCOPE_LABELS[scope]?.description ?? ''}</span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            ノートの削除は許可されません。接続は設定画面の「エージェント連携」からいつでも解除できます。
          </p>
        </fieldset>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => decide(false)}
          disabled={submitting}
          className="px-4 py-2 text-sm text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          拒否する
        </button>
        <button
          type="button"
          onClick={() => decide(true)}
          disabled={submitting}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
        >
          許可する
        </button>
      </div>
    </div>
  )
}

export default function ConsentPage() {
  return (
    <div className="max-w-xl mx-auto mt-8">
      <Suspense fallback={<p className="text-center text-gray-600">Loading...</p>}>
        <ConsentContent />
      </Suspense>
    </div>
  )
}
