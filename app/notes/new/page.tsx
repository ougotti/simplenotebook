'use client'
import { useState, FormEvent, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useAuth } from '../../../hooks/useAuth'
import { useNotes } from '../../../hooks/useNotes'
import { useNoteSearch } from '../../../hooks/useNoteSearch'
import { getUserDisplayName } from '../../../utils/userDisplay'
import UserDisplay from '../../../components/UserDisplay'
import ThemeToggle from '../../../components/ThemeToggle'
import SearchBox from '../../../components/SearchBox'
import TagInput from '../../../components/TagInput'

function NewNotePageContent() {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isProcessingCallback, setIsProcessingCallback] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null)
  
  const searchParams = useSearchParams()
  const router = useRouter()
  const { user, signOut, isLocal } = useAuth()
  const { notes, loading, error, createNote, updateNote, deleteNote, getNote, fetchNotes } = useNotes()
  const { query, setQuery, filteredNotes, isSearching } = useNoteSearch(notes, getNote)
  // キーワード検索の結果にタグ絞り込みを重ねる (両方指定時は AND 条件)
  const visibleNotes = selectedTag
    ? filteredNotes.filter(note => (note.tags ?? []).includes(selectedTag))
    : filteredNotes

  // Handle OAuth callback
  useEffect(() => {
    if (!searchParams) return
    
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    
    if (code && state) {
      setIsProcessingCallback(true)
      setMessage('Processing OAuth callback...')
      
      // AWS Amplify handles the OAuth callback automatically
      // We just need to clean up the URL after processing
      const OAUTH_CALLBACK_TIMEOUT_MS =
        typeof process !== 'undefined' && process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT
          ? parseInt(process.env.NEXT_PUBLIC_OAUTH_CALLBACK_TIMEOUT, 10)
          : 3000;
      
      const timer = setTimeout(() => {
        // Clean up URL parameters
        window.history.replaceState({}, '', window.location.pathname)
        setIsProcessingCallback(false)
        setMessage('')
      }, OAUTH_CALLBACK_TIMEOUT_MS)
      
      return () => clearTimeout(timer)
    }
  }, [searchParams])

  useEffect(() => {
    const saved = window.localStorage.getItem('new-note-content')
    const savedTitle = window.localStorage.getItem('new-note-title')
    if (saved) {
      setContent(saved)
    }
    if (savedTitle) {
      setTitle(savedTitle)
    }
  }, [])

  // Auto-save to localStorage
  useEffect(() => {
    window.localStorage.setItem('new-note-content', content)
    window.localStorage.setItem('new-note-title', title)
  }, [content, title])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsSaving(true)
    setMessage('')

    try {
      if (editingNote) {
        // Update existing note
        await updateNote(editingNote, {
          title: title || 'Untitled',
          content,
          tags,
        })
        setMessage('ノートを更新しました！')
      } else {
        // Create new note
        await createNote({
          title: title || 'Untitled',
          content,
          tags,
        })
        setMessage(isLocal ? 'ノートを保存しました（ローカル保存）' : 'ノートを保存しました！')
      }
      
      // Clear form after successful save
      setContent('')
      setTitle('')
      setTags([])
      setEditingNote(null)
      window.localStorage.removeItem('new-note-content')
      window.localStorage.removeItem('new-note-title')
      
    } catch (err) {
      setMessage(editingNote ? '更新に失敗しました。もう一度お試しください。' : '保存に失敗しました。もう一度お試しください。')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleEditNote(noteId: string) {
    try {
      const note = await getNote(noteId)
      if (note) {
        setTitle(note.title)
        setContent(note.content)
        setTags(note.tags ?? [])
        setEditingNote(noteId)
        setMessage('')
      }
    } catch (err) {
      setMessage('ノートの読み込みに失敗しました。')
    }
  }

  function handleDeleteNote(noteId: string) {
    setPendingDeleteNoteId(noteId)
    setShowDeleteModal(true)
  }

  async function confirmDeleteNote() {
    if (!pendingDeleteNoteId) return
    setShowDeleteModal(false)
    try {
      await deleteNote(pendingDeleteNoteId)
      setMessage('ノートを削除しました。')
      // Optionally clear edit state if the deleted note was being edited
      if (editingNote === pendingDeleteNoteId) {
        setEditingNote(null)
        setTitle('')
        setContent('')
        setTags([])
      }
    } catch (err) {
      setMessage('削除に失敗しました。もう一度お試しください。')
    } finally {
      setPendingDeleteNoteId(null)
    }
  }

  function cancelDeleteNote() {
    setShowDeleteModal(false)
    setPendingDeleteNoteId(null)
  }

  function handleCancelEdit() {
    setEditingNote(null)
    setTitle('')
    setContent('')
    setTags([])
    setMessage('')
    window.localStorage.removeItem('new-note-content')
    window.localStorage.removeItem('new-note-title')
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* OAuth Callback Processing Message */}
      {isProcessingCallback && (
        <div className="mb-6 p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-700">
          <p className="flex items-center">
            <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400 mr-2"></span>
            Processing OAuth authentication...
          </p>
        </div>
      )}

      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">SimpleNotebook</h1>
          {isLocal && (
            <p className="text-sm text-orange-600 dark:text-orange-400">
              開発モード - ローカルストレージ使用中
            </p>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-right">
            <UserDisplay />
            {user?.signInDetails?.loginId && (
              <div className="text-xs text-gray-500">
                {user.signInDetails.loginId}
              </div>
            )}
          </div>
          <div className="flex items-center space-x-2">
            <ThemeToggle />
            <button
              onClick={() => router.push('/settings')}
              className="text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100 underline"
            >
              設定
            </button>
            <button
              onClick={signOut}
              className="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
            >
              サインアウト
            </button>
          </div>
        </div>
      </div>

      {/* Notes List */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* New Note Form */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              {editingNote ? 'ノートを編集' : '新規ノート'}
            </h2>
            {editingNote && (
              <button
                onClick={handleCancelEdit}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                キャンセル
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              className="w-full border dark:border-gray-600 rounded p-2 bg-white dark:bg-gray-800"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ノートのタイトル"
            />
            <TagInput tags={tags} onChange={setTags} disabled={isSaving} />
            <textarea
              className="w-full h-64 border dark:border-gray-600 rounded p-2 font-mono text-sm bg-white dark:bg-gray-800"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Markdownを書いてください..."
            />
            <button
              type="submit"
              disabled={isSaving || isProcessingCallback}
              className="bg-blue-500 text-white px-4 py-2 rounded disabled:bg-gray-400"
            >
              {isSaving ? (editingNote ? '更新中...' : '保存中...') : (editingNote ? '更新' : '保存')}
            </button>
            {message && (
              <p className={`text-sm ${message.includes('失敗') ? 'text-red-600' : 'text-green-600'}`}>
                {message}
              </p>
            )}
          </form>
        </div>

        {/* Notes List */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">保存されたノート</h2>
            <button
              onClick={fetchNotes}
              className="text-sm text-blue-500 hover:text-blue-700 dark:hover:text-blue-400"
            >
              更新
            </button>
          </div>

          <SearchBox value={query} onChange={setQuery} />

          {selectedTag && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
              <span>タグで絞り込み:</span>
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                aria-label={`タグ「${selectedTag}」の絞り込みを解除`}
                className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full px-2 py-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                data-testid="active-tag-filter"
              >
                {selectedTag} ✕
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center text-gray-500 dark:text-gray-400">
              ノートを読み込み中...
            </div>
          )}

          {error && (
            <div className="text-red-600 dark:text-red-400 text-sm">
              エラー: {error}
            </div>
          )}

          {notes.length === 0 && !loading && (
            <div className="text-gray-500 dark:text-gray-400 text-center">
              まだノートがありません
            </div>
          )}

          {notes.length > 0 && filteredNotes.length === 0 && isSearching && (
            <div className="text-gray-500 dark:text-gray-400 text-center" data-testid="search-no-results">
              「{query}」に一致するノートはありません
            </div>
          )}

          {notes.length > 0 && filteredNotes.length > 0 && visibleNotes.length === 0 && selectedTag && (
            <div className="text-gray-500 dark:text-gray-400 text-center" data-testid="tag-no-results">
              タグ「{selectedTag}」のノートはありません
            </div>
          )}

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {visibleNotes.map((note) => (
              <div key={note.id} className="border dark:border-gray-700 rounded p-3 hover:bg-gray-50 dark:hover:bg-gray-800">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-medium text-sm">{note.title}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      作成: {new Date(note.createdAt).toLocaleDateString('ja-JP')}
                      {note.updatedAt !== note.createdAt && (
                        <span className="ml-2">
                          更新: {new Date(note.updatedAt).toLocaleDateString('ja-JP')}
                        </span>
                      )}
                    </p>
                    {(note.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {(note.tags ?? []).map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setSelectedTag(tag)}
                            aria-label={`タグ「${tag}」で絞り込み`}
                            className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full px-2 py-0.5 hover:bg-blue-200 dark:hover:bg-blue-800"
                            data-testid="note-tag"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex space-x-2 ml-2">
                    <button
                      onClick={() => handleEditNote(note.id)}
                      className="text-xs text-blue-500 hover:text-blue-700 px-2 py-1 rounded border border-blue-200 hover:border-blue-300"
                      disabled={isSaving}
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDeleteNote(note.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded border border-red-200 hover:border-red-300"
                      disabled={isSaving}
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">ノートを削除</h3>
            <p className="text-gray-600 dark:text-gray-300 mb-6">このノートを削除しますか？この操作は元に戻せません。</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelDeleteNote}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 dark:text-gray-300 dark:hover:text-gray-100"
              >
                キャンセル
              </button>
              <button
                onClick={confirmDeleteNote}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600"
              >
                削除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function NewNotePage() {
  return (
    <Suspense fallback={
      <div className="max-w-4xl mx-auto">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <NewNotePageContent />
    </Suspense>
  )
}
