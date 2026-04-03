'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Plus, Pencil, Trash2, Clock, CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { today } from '@/lib/utils'
import type { Task } from '@/types'

type Filter = 'all' | 'pending' | 'done'

const fetcher = (url: string) => fetch(url).then(r => r.json())

interface TaskDialogProps {
  task?: Task | null
  defaultDate?: string
  onClose: () => void
  onSave: () => void
}

function TaskDialog({ task, defaultDate, onClose, onSave }: TaskDialogProps) {
  const [title, setTitle] = useState(task?.title || '')
  const [time, setTime] = useState(task?.time || '09:00')
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>(task?.priority || 'medium')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    if (!title.trim()) return
    setLoading(true)
    setError('')

    try {
      const url = task ? `/api/tasks/${task.id}` : '/api/tasks'
      const method = task ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          time,
          priority,
          date: defaultDate || today(),
        }),
      })

      if (res.ok) {
        onSave()
        onClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Bir hata oluştu.')
      }
    } catch {
      setError('Bağlantı hatası.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6 z-10"
        style={{
          background: 'rgba(17,17,27,0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <h2 className="text-white font-semibold mb-5">{task ? 'Görevi Düzenle' : 'Yeni Görev'}</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Başlık</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Görev başlığı..."
              className="w-full px-4 py-2.5 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Saat</label>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                colorScheme: 'dark',
              }}
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Öncelik</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as 'high' | 'medium' | 'low')}
              className="w-full px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                colorScheme: 'dark',
              }}
            >
              <option value="high">Yüksek</option>
              <option value="medium">Orta</option>
              <option value="low">Düşük</option>
            </select>
          </div>

          {error && <p className="text-red-400 text-xs">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-zinc-400 text-sm transition-all hover:text-white"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            İptal
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim()}
            className="flex-1 py-2.5 rounded-xl text-white text-sm font-medium transition-all disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            {loading ? <Loader2 size={16} className="animate-spin mx-auto" /> : (task ? 'Güncelle' : 'Ekle')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TasksPage() {
  const todayDate = today()
  const [filter, setFilter] = useState<Filter>('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)

  const { data: tasks, mutate, isLoading } = useSWR<Task[]>(
    `/api/tasks?date=${todayDate}`,
    fetcher
  )

  const filtered = (tasks || []).filter(t => {
    if (filter === 'pending') return t.status === 'pending'
    if (filter === 'done') return t.status === 'done'
    return true
  })

  async function toggleDone(task: Task) {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    mutate()
  }

  async function deleteTask(id: string) {
    if (!confirm('Bu görevi silmek istediğinizden emin misiniz?')) return
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    mutate()
  }

  const priorityColors: Record<string, string> = {
    high: '#f87171',
    medium: '#fbbf24',
    low: '#6b7280',
  }

  const filterTabs: { key: Filter; label: string }[] = [
    { key: 'all', label: 'Tümü' },
    { key: 'pending', label: 'Bekleyen' },
    { key: 'done', label: 'Tamamlanan' },
  ]

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Görevler</h1>
          <p className="text-zinc-500 text-sm mt-0.5">Bugünün görevleri</p>
        </div>
        <button
          onClick={() => { setEditTask(null); setDialogOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
        >
          <Plus size={16} />
          Görev Ekle
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === tab.key ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-zinc-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <p className="text-zinc-500 text-sm">
            {filter === 'all' ? 'Bugün için görev yok.' : 'Bu filtrede görev yok.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => {
            const isDone = task.status === 'done'
            return (
              <div
                key={task.id}
                className={`flex items-center gap-4 px-5 py-3.5 rounded-xl transition-all ${isDone ? 'opacity-50' : ''}`}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                {/* Done toggle */}
                <button onClick={() => toggleDone(task)} className="flex-shrink-0 transition-colors">
                  {isDone
                    ? <CheckCircle2 size={18} className="text-green-400" />
                    : <Circle size={18} className="text-zinc-600 hover:text-yellow-400" />
                  }
                </button>

                {/* Time */}
                <span className="flex items-center gap-1.5 text-xs font-mono flex-shrink-0" style={{ color: '#60a5fa' }}>
                  <Clock size={12} />
                  {task.time}
                </span>

                {/* Title */}
                <span className={`flex-1 text-sm ${isDone ? 'line-through text-zinc-600' : 'text-white'}`}>
                  {task.title}
                </span>

                {/* Priority dot */}
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: priorityColors[task.priority] || '#6b7280' }}
                />

                {/* Actions */}
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={() => { setEditTask(task); setDialogOpen(true) }}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-blue-400 hover:bg-blue-500/10 transition-all"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteTask(task.id)}
                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Summary */}
      {(tasks?.length ?? 0) > 0 && (
        <p className="text-zinc-600 text-xs mt-4 text-center">
          {tasks!.filter(t => t.status === 'done').length}/{tasks!.length} görev tamamlandı
        </p>
      )}

      {/* Dialog */}
      {dialogOpen && (
        <TaskDialog
          task={editTask}
          defaultDate={todayDate}
          onClose={() => { setDialogOpen(false); setEditTask(null) }}
          onSave={() => mutate()}
        />
      )}
    </div>
  )
}
