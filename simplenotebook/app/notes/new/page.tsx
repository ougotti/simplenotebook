'use client'
import { useState, FormEvent } from 'react'

export default function NewNotePage() {
  const [content, setContent] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setMessage('')
    const res = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    })
    if (res.ok) {
      setContent('')
      setMessage('保存しました')
    } else {
      setMessage('保存に失敗しました')
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">新規ノート</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <textarea
          className="w-full border rounded p-2 h-40"
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
