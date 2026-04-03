'use client'

import { useState, FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Clock } from 'lucide-react'

interface QuickAddTaskProps {
  todayDate: string
}

export default function QuickAddTask({ todayDate }: QuickAddTaskProps) {
  const router = useRouter()
  const [time, setTime] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return

    setLoading(true)
    setFeedback(null)

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          time: time || '09:00',
          date: todayDate,
          priority: 'medium',
        }),
      })

      if (res.ok) {
        setTitle('')
        setTime('')
        setFeedback({ type: 'success', msg: 'Görev eklendi!' })
        router.refresh()
        setTimeout(() => setFeedback(null), 2000)
      } else {
        const data = await res.json()
        setFeedback({ type: 'error', msg: data.error || 'Görev eklenemedi.' })
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Bağlantı hatası.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <h2 className="text-white font-semibold text-sm mb-4 flex items-center gap-2">
        <Plus size={15} className="text-zinc-400" />
        Hızlı Görev Ekle
      </h2>

      <form onSubmit={handleSubmit} className="flex gap-3">
        {/* Time */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <Clock size={14} className="text-zinc-500" />
          <input
            type="time"
            value={time}
            onChange={e => setTime(e.target.value)}
            className="px-3 py-2 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all w-28"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
              colorScheme: 'dark',
            }}
          />
        </div>

        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Görev başlığı..."
          required
          className="flex-1 px-4 py-2 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        />

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !title.trim()}
          className="px-4 py-2 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
        >
          {loading ? '...' : 'Ekle'}
        </button>
      </form>

      {feedback && (
        <p
          className={`text-xs mt-2 ${
            feedback.type === 'success' ? 'text-green-400' : 'text-red-400'
          }`}
        >
          {feedback.msg}
        </p>
      )}
    </div>
  )
}
