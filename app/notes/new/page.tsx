'use client'
import { useState, FormEvent, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '../../../hooks/useAuth'
import { useNotes } from '../../../hooks/useNotes'
import { getUserDisplayName } from '../../../utils/userDisplay'

function NewNotePageContent() {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isProcessingCallback, setIsProcessingCallback] = useState(false)
  const [editingNote, setEditingNote] = useState<string | null>(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = useState<string | null>(null)
  
  const searchParams = useSearchParams()
  const { user, signOut, isLocal } = useAuth()
  const { notes, loading, error, createNote, updateNote, deleteNote, getNote, fetchNotes } = useNotes()

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
        })
        setMessage('ノートを更新しました！')
      } else {
        // Create new note
        await createNote({
          title: title || 'Untitled',
          content,
        })
        setMessage(isLocal ? 'ノートを保存しました（ローカル保存）' : 'ノートを保存しました！')
      }
      
      // Clear form after successful save
      setContent('')
      setTitle('')
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
            <p className="text-sm text-orange-600">
              開発モード - ローカルストレージ使用中
            </p>
          )}
        </div>
        <div className="flex items-center space-x-4">
          <div className="text-right">
            <div className="text-sm font-medium text-gray-800">
              {getUserDisplayName(user)}
            </div>
            {user?.signInDetails?.loginId && getUserDisplayName(user) !== user.signInDetails.loginId && (
              <div className="text-xs text-gray-500">
                {user.signInDetails.loginId}
              </div>
            )}
          </div>
          <button
            onClick={signOut}
            className="text-sm text-blue-500 hover:text-blue-700"
          >
            サインアウト
          </button>
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
              className="w-full border rounded p-2"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="ノートのタイトル"
            />
            <textarea
              className="w-full h-64 border rounded p-2 font-mono text-sm"
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
              className="text-sm text-blue-500 hover:text-blue-700"
            >
              更新
            </button>
          </div>
          
          {loading && (
            <div className="text-center text-gray-500">
              ノートを読み込み中...
            </div>
          )}
          
          {error && (
            <div className="text-red-600 text-sm">
              エラー: {error}
            </div>
          )}
          
          {notes.length === 0 && !loading && (
            <div className="text-gray-500 text-center">
              まだノートがありません
            </div>
          )}
          
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {notes.map((note) => (
              <div key={note.id} className="border rounded p-3 hover:bg-gray-50">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="font-medium text-sm">{note.title}</h3>
                    <p className="text-xs text-gray-500">
                      作成: {new Date(note.createdAt).toLocaleDateString('ja-JP')}
                      {note.updatedAt !== note.createdAt && (
                        <span className="ml-2">
                          更新: {new Date(note.updatedAt).toLocaleDateString('ja-JP')}
                        </span>
                      )}
                    </p>
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
          <div className="bg-white rounded-lg p-6 max-w-sm mx-4">
            <h3 className="text-lg font-semibold mb-4">ノートを削除</h3>
            <p className="text-gray-600 mb-6">このノートを削除しますか？この操作は元に戻せません。</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={cancelDeleteNote}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
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
