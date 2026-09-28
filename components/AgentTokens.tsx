'use client';

import { useEffect, useState, FormEvent } from 'react';
import {
  apiClient,
  AccessToken,
  AccessTokenScope,
  ApiError,
  CreateAccessTokenResponse,
} from '../lib/api';

const SCOPE_OPTIONS: { value: AccessTokenScope; label: string; description: string }[] = [
  { value: 'notes:read', label: '読み取り', description: 'ノートの一覧・本文の取得' },
  { value: 'notes:write', label: '書き込み', description: 'ノートの作成・更新' },
];

const SCOPE_LABELS: Record<string, string> = {
  'notes:read': '読み取り',
  'notes:write': '書き込み',
  'notes:delete': '削除',
};

const EXPIRY_OPTIONS = [7, 30, 60, 90];
const DEFAULT_EXPIRY_DAYS = 30;
const MAX_NAME_LENGTH = 100;

const STATUS_LABELS: Record<AccessToken['status'], { label: string; className: string }> = {
  active: { label: '有効', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' },
  expired: { label: '期限切れ', className: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
  revoked: { label: '失効済み', className: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' },
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString('ja-JP') : '—';
}

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.serverMessage) return err.serverMessage;
  if (err instanceof Error && !err.message.startsWith('API request failed')) return err.message;
  return fallback;
}

export default function AgentTokens() {
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<AccessTokenScope[]>(['notes:read']);
  const [expiresInDays, setExpiresInDays] = useState(DEFAULT_EXPIRY_DAYS);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [issued, setIssued] = useState<CreateAccessTokenResponse | null>(null);
  const [copied, setCopied] = useState<'token' | 'example' | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function loadTokens() {
    try {
      setTokens(await apiClient.listAccessTokens());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'トークンの読み込みに失敗しました。'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTokens();
    apiClient.isLocal().then(setIsLocal).catch(() => undefined);
    apiClient.getApiBaseUrl().then(setApiBaseUrl).catch(() => undefined);
  }, []);

  function toggleScope(scope: AccessTokenScope) {
    setScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]));
  }

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('トークンの名前を入力してください。');
      return;
    }
    if (scopes.length === 0) {
      setFormError('権限を 1 つ以上選んでください。');
      return;
    }
    setCreating(true);
    setFormError(null);
    try {
      const response = await apiClient.createAccessToken({ name: trimmed, scopes, expiresInDays });
      setIssued(response);
      setCopied(null);
      setName('');
      setScopes(['notes:read']);
      setExpiresInDays(DEFAULT_EXPIRY_DAYS);
      await loadTokens();
    } catch (err) {
      setFormError(errorMessage(err, 'トークンの発行に失敗しました。'));
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(tokenId: string) {
    setConfirmRevokeId(null);
    setRevokingId(tokenId);
    try {
      await apiClient.revokeAccessToken(tokenId);
      await loadTokens();
    } catch (err) {
      setError(errorMessage(err, 'トークンの失効に失敗しました。'));
    } finally {
      setRevokingId(null);
    }
  }

  async function copy(text: string, kind: 'token' | 'example') {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
    } catch {
      // クリップボードが使えない環境では、表示されたテキストを手で選択してもらう
      setCopied(null);
    }
  }

  const curlExample = issued
    ? `curl -H "Authorization: Bearer ${issued.token}" ${apiBaseUrl || '<API の URL>'}/notes`
    : '';

  return (
    <section className="bg-white dark:bg-gray-800 shadow rounded-lg mt-8" data-testid="agent-tokens">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100">エージェント連携</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          AI エージェントやスクリプトから、あなたの権限でノートを読み書きするためのアクセストークンを発行します。
          ノートの削除はエージェントに許可していません。
        </p>
        {isLocal && (
          <p className="mt-2 text-sm text-orange-600 dark:text-orange-400">
            開発モード: 発行されるのはローカルの模擬トークンで、実際の API では使えません。
          </p>
        )}
      </div>

      {/* 発行直後のトークン(このときだけ表示できる) */}
      {issued && (
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-950" data-testid="issued-token">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            トークン「{issued.tokenInfo.name}」を発行しました。この画面を離れると二度と表示できないため、今すぐ安全な場所に保存してください。
          </p>
          <div className="mt-3 flex gap-2 items-start">
            <code
              className="flex-1 block break-all text-xs bg-white dark:bg-gray-900 border dark:border-gray-700 rounded p-2 select-all"
              data-testid="issued-token-value"
            >
              {issued.token}
            </code>
            <button
              type="button"
              onClick={() => copy(issued.token, 'token')}
              className="text-sm bg-blue-600 text-white px-3 py-2 rounded-md hover:bg-blue-700"
            >
              {copied === 'token' ? 'コピーしました' : 'コピー'}
            </button>
          </div>

          <div className="mt-4">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">接続例(API を直接呼ぶ場合)</p>
            <div className="mt-2 flex gap-2 items-start">
              <code className="flex-1 block break-all text-xs bg-white dark:bg-gray-900 border dark:border-gray-700 rounded p-2 select-all" data-testid="curl-example">
                {curlExample}
              </code>
              <button
                type="button"
                onClick={() => copy(curlExample, 'example')}
                className="text-sm border border-blue-600 text-blue-600 dark:text-blue-400 px-3 py-2 rounded-md hover:bg-blue-50 dark:hover:bg-gray-800"
              >
                {copied === 'example' ? 'コピーしました' : 'コピー'}
              </button>
            </div>
            <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
              Claude Code や Codex から MCP で接続する方法は、MCP サーバーの提供開始後にここに表示されます。
            </p>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 underline"
            >
              保存したので閉じる
            </button>
          </div>
        </div>
      )}

      {/* 発行フォーム */}
      <form onSubmit={handleCreate} className="px-6 py-4 space-y-4 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">新しいトークンを発行</h3>
        <div>
          <label htmlFor="token-name" className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
            名前(どこで使うかがわかる名前)
          </label>
          <input
            id="token-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={MAX_NAME_LENGTH}
            placeholder="例: Claude Code (ノートPC)"
            className="w-full border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-900"
            disabled={creating}
          />
        </div>

        <fieldset>
          <legend className="block text-sm text-gray-700 dark:text-gray-300 mb-1">権限</legend>
          <div className="space-y-1">
            {SCOPE_OPTIONS.map(option => (
              <label key={option.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes(option.value)}
                  onChange={() => toggleScope(option.value)}
                  disabled={creating}
                />
                <span className="text-gray-900 dark:text-gray-100">{option.label}</span>
                <span className="text-gray-500 dark:text-gray-400">— {option.description}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label htmlFor="token-expiry" className="block text-sm text-gray-700 dark:text-gray-300 mb-1">
            有効期限
          </label>
          <select
            id="token-expiry"
            value={expiresInDays}
            onChange={e => setExpiresInDays(Number(e.target.value))}
            className="border dark:border-gray-600 rounded px-2 py-1 bg-white dark:bg-gray-900"
            disabled={creating}
          >
            {EXPIRY_OPTIONS.map(days => (
              <option key={days} value={days}>
                {days} 日
              </option>
            ))}
          </select>
        </div>

        {formError && (
          <p className="text-sm text-red-600 dark:text-red-400" role="alert">
            {formError}
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={creating}
            className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400"
          >
            {creating ? '発行中...' : '発行する'}
          </button>
        </div>
      </form>

      {/* 発行済みトークン */}
      <div className="px-6 py-4">
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">発行済みのトークン</h3>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 mb-2" role="alert">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">読み込み中...</p>
        ) : tokens.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="no-tokens">
            まだトークンはありません
          </p>
        ) : (
          <ul className="space-y-2">
            {tokens.map(token => {
              const status = STATUS_LABELS[token.status];
              return (
                <li
                  key={token.tokenId}
                  className="border dark:border-gray-700 rounded p-3"
                  data-testid="token-row"
                  data-status={token.status}
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 break-all">{token.name}</span>
                        <span className={`text-xs rounded-full px-2 py-0.5 ${status.className}`} data-testid="token-status">
                          {status.label}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                        権限: {token.scopes.map(scope => SCOPE_LABELS[scope] ?? scope).join('・')}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        作成: {formatDate(token.createdAt)} / 期限: {formatDate(token.expiresAt)} / 最終使用:{' '}
                        {token.lastUsedAt ? formatDate(token.lastUsedAt) : '未使用'}
                      </p>
                    </div>
                    {token.status === 'active' && (
                      confirmRevokeId === token.tokenId ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-700 dark:text-gray-300">失効しますか?</span>
                          <button
                            type="button"
                            onClick={() => handleRevoke(token.tokenId)}
                            className="text-xs bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                          >
                            失効する
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(null)}
                            className="text-xs text-gray-600 dark:text-gray-300 px-2 py-1"
                          >
                            キャンセル
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(token.tokenId)}
                          disabled={revokingId === token.tokenId}
                          className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:border-red-300 shrink-0"
                        >
                          {revokingId === token.tokenId ? '失効中...' : '失効'}
                        </button>
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
