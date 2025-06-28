'use client'
import { useState, FormEvent, useEffect } from 'react'

export default function NewNotePage() {
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    const saved = window.localStorage.getItem('new-note-content')
    if (saved) {
      setContent(saved)
    }
  }, [])

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    window.localStorage.setItem('new-note-content', content)
    setMessage('保存しました（ローカル保存）')
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">新規ノート</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-screen h-screen border rounded p-2"
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="Markdownを書いてください"
        />
        <button
          type="submit"
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          保存
        </button>
        {message && <p className="text-green-600">{message}</p>}
      </form>
    </div>
  )
}
