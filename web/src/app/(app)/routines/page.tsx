'use client'

import { useState } from 'react'
import useSWR from 'swr'
import type { DailyRoutine } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function RoutinesPage() {
  const { data: routines = [], mutate } = useSWR<DailyRoutine[]>('/api/routines', fetcher)
  const [text, setText] = useState('')
  const [time, setTime] = useState('')
  const [loading, setLoading] = useState(false)

  async function addRoutine() {
    if (!text.trim()) return
    setLoading(true)
    await fetch('/api/routines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim(), time: time || null }),
    })
    setText('')
    setTime('')
    setLoading(false)
    mutate()
  }

  async function deleteRoutine(id: string) {
    await fetch(`/api/routines/${id}`, { method: 'DELETE' })
    mutate()
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Günlük Yapılacaklar</h1>
        <p className="text-zinc-400 text-sm">Her gün otomatik olarak planına dahil edilecek rutinler ve talimatlar.</p>
      </div>

      {/* Add routine */}
      <div
        className="rounded-2xl p-6 mb-6"
        style={{
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <h2 className="text-white font-medium mb-4">Yeni Rutin Ekle</h2>
        <div className="space-y-3">
          <input
            type="text"
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addRoutine()}
            placeholder="Örn: Her gün sabah 7'de günlük planı gönder"
            className="w-full px-4 py-2.5 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          />
          <div className="flex gap-3">
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40 transition-all"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                colorScheme: 'dark',
              }}
            />
            <button
              onClick={addRoutine}
              disabled={loading || !text.trim()}
              className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
            >
              {loading ? 'Ekleniyor...' : 'Ekle'}
            </button>
          </div>
        </div>
      </div>

      {/* Routines list */}
      <div className="space-y-3">
        {routines.length === 0 ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <p className="text-zinc-500 text-sm">Henüz rutin eklenmemiş.</p>
            <p className="text-zinc-600 text-xs mt-1">Sohbet ekranında &quot;Her gün sabah 7&apos;de günlük planı gönder&quot; gibi söyleyerek de ekleyebilirsin.</p>
          </div>
        ) : (
          routines.map(routine => (
            <div
              key={routine.id}
              className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-lg">🔁</span>
                <div className="min-w-0">
                  <p className="text-white text-sm truncate">{routine.text}</p>
                  {routine.time && (
                    <p className="text-zinc-500 text-xs mt-0.5">{routine.time}</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => deleteRoutine(routine.id)}
                className="text-zinc-600 hover:text-red-400 transition-colors text-xs shrink-0"
              >
                Sil
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
