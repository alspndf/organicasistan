'use client'

import { useState, useRef, useEffect } from 'react'
import useSWR from 'swr'
import {
  Plus, Pencil, Trash2, Clock, CheckCircle2, Circle,
  Loader2, ChevronLeft, ChevronRight, CalendarDays,
} from 'lucide-react'
import { today } from '@/lib/utils'
import type { Task } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const TR_DAYS  = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt']
const TR_MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık']

function addDays(base: string, n: number): string {
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function formatHeader(dateStr: string, todayStr: string): { top: string; bottom: string; isToday: boolean; isTomorrow: boolean } {
  const d = new Date(dateStr + 'T12:00:00')
  const isToday = dateStr === todayStr
  const isTomorrow = dateStr === addDays(todayStr, 1)
  const dayLabel = TR_DAYS[d.getDay()]
  const dateLabel = `${d.getDate()} ${TR_MONTHS[d.getMonth()]}`
  return {
    top: isToday ? 'Bugün' : isTomorrow ? 'Yarın' : dayLabel,
    bottom: dateLabel,
    isToday,
    isTomorrow,
  }
}

// ─── Task Dialog ──────────────────────────────────────────────────────────────
interface TaskDialogProps {
  task?: Task | null
  defaultDate: string
  onClose: () => void
  onSave: () => void
}

function TaskDialog({ task, defaultDate, onClose, onSave }: TaskDialogProps) {
  const todayStr = today()
  const [title, setTitle] = useState(task?.title || '')
  const [time, setTime] = useState(task?.time || '09:00')
  const [date, setDate] = useState(task?.date || defaultDate)
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
        body: JSON.stringify({ title: title.trim(), time, date, priority }),
      })
      if (res.ok) { onSave(); onClose() }
      else { const d = await res.json(); setError(d.error || 'Hata oluştu.') }
    } catch { setError('Bağlantı hatası.') }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-2xl p-6 z-10"
        style={{ background: 'rgba(17,17,27,0.97)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        <h2 className="text-white font-semibold mb-5">{task ? 'Görevi Düzenle' : 'Yeni Görev'}</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Başlık</label>
            <input
              type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Görev başlığı..." autoFocus
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className="w-full px-4 py-2.5 rounded-xl text-white placeholder-zinc-600 text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Saat</label>
              <input
                type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', colorScheme: 'dark' }}
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1.5">Tarih</label>
              <input
                type="date" value={date} min={todayStr} onChange={e => setDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', colorScheme: 'dark' }}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Öncelik</label>
            <select
              value={priority} onChange={e => setPriority(e.target.value as 'high' | 'medium' | 'low')}
              className="w-full px-4 py-2.5 rounded-xl text-white text-sm outline-none focus:ring-2 focus:ring-blue-500/40"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', colorScheme: 'dark' }}
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
            onClick={handleSubmit} disabled={loading || !title.trim()}
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

// ─── Priority colors ──────────────────────────────────────────────────────────
const PRIORITY: Record<string, string> = { high: '#f87171', medium: '#fbbf24', low: '#6b7280' }

// ─── Single task row ──────────────────────────────────────────────────────────
function TaskRow({
  task,
  onToggle,
  onEdit,
  onDelete,
}: {
  task: Task
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const done = task.status === 'done'
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${done ? 'opacity-40' : ''}`}
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      <button onClick={onToggle} className="flex-shrink-0">
        {done
          ? <CheckCircle2 size={16} className="text-green-400" />
          : <Circle size={16} className="text-zinc-600 hover:text-yellow-400 transition-colors" />}
      </button>
      <span className="flex items-center gap-1 text-xs font-mono flex-shrink-0" style={{ color: '#60a5fa' }}>
        <Clock size={11} />{task.time}
      </span>
      <span className={`flex-1 text-sm min-w-0 truncate ${done ? 'line-through text-zinc-600' : 'text-white'}`}>
        {task.title}
      </span>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: PRIORITY[task.priority] || PRIORITY.medium }} />
      <div className="flex gap-1 flex-shrink-0">
        <button onClick={onEdit} className="p-1 rounded-lg text-zinc-600 hover:text-blue-400 hover:bg-blue-500/10 transition-all">
          <Pencil size={12} />
        </button>
        <button onClick={onDelete} className="p-1 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-all">
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

// ─── Day section ──────────────────────────────────────────────────────────────
function DaySection({
  dateStr,
  todayStr,
  tasks,
  onAdd,
  onEdit,
  onToggle,
  onDelete,
}: {
  dateStr: string
  todayStr: string
  tasks: Task[]
  onAdd: (date: string) => void
  onEdit: (task: Task) => void
  onToggle: (task: Task) => void
  onDelete: (id: string) => void
}) {
  const { top, bottom, isToday, isTomorrow } = formatHeader(dateStr, todayStr)
  const pending = tasks.filter(t => t.status === 'pending').length
  const done = tasks.filter(t => t.status === 'done').length

  return (
    <div
      id={`day-${dateStr}`}
      className="rounded-2xl overflow-hidden"
      style={{
        border: isToday
          ? '1px solid rgba(99,102,241,0.4)'
          : '1px solid rgba(255,255,255,0.07)',
        background: isToday
          ? 'rgba(99,102,241,0.05)'
          : 'rgba(255,255,255,0.02)',
      }}
    >
      {/* Day header */}
      <div className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: tasks.length ? '1px solid rgba(255,255,255,0.06)' : 'none' }}
      >
        <div className="flex items-center gap-3">
          <div className="text-center">
            <div className={`text-xs font-semibold uppercase tracking-wider ${
              isToday ? 'text-indigo-400' : isTomorrow ? 'text-blue-400' : 'text-zinc-400'
            }`}>
              {top}
            </div>
            <div className="text-white text-sm font-medium">{bottom}</div>
          </div>
          {tasks.length > 0 && (
            <div className="flex items-center gap-2">
              {pending > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'rgba(251,191,36,0.15)', color: '#fbbf24' }}>
                  {pending} bekleyen
                </span>
              )}
              {done > 0 && (
                <span className="px-2 py-0.5 rounded-full text-xs" style={{ background: 'rgba(74,222,128,0.12)', color: '#4ade80' }}>
                  {done} tamamlandı
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => onAdd(dateStr)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
          style={{
            background: isToday ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
            color: isToday ? '#a5b4fc' : '#94a3b8',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <Plus size={12} /> Ekle
        </button>
      </div>

      {/* Task rows */}
      {tasks.length > 0 && (
        <div className="p-3 space-y-2">
          {tasks.map(task => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => onToggle(task)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
const VISIBLE_DAYS = 21 // 3 weeks ahead

export default function TasksPage() {
  const todayStr = today()

  // Build list of dates: today + VISIBLE_DAYS
  const dates = Array.from({ length: VISIBLE_DAYS }, (_, i) => addDays(todayStr, i))

  // Start of current week for the strip
  const [weekOffset, setWeekOffset] = useState(0)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editTask, setEditTask] = useState<Task | null>(null)
  const [dialogDate, setDialogDate] = useState(todayStr)

  // Compute startDate / endDate for range fetch
  const startDate = todayStr
  const endDate = addDays(todayStr, VISIBLE_DAYS - 1)

  const { data: tasks, mutate, isLoading } = useSWR<Task[]>(
    `/api/tasks?startDate=${startDate}&endDate=${endDate}`,
    fetcher,
    { refreshInterval: 30000 }
  )

  // Group tasks by date
  const tasksByDate = (tasks || []).reduce<Record<string, Task[]>>((acc, t) => {
    if (!acc[t.date]) acc[t.date] = []
    acc[t.date].push(t)
    return acc
  }, {})

  // Week strip: 7 days starting from weekOffset * 7
  const stripStart = weekOffset * 7
  const stripDates = Array.from({ length: 7 }, (_, i) => addDays(todayStr, stripStart + i))

  async function toggleDone(task: Task) {
    await fetch(`/api/tasks/${task.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: task.status === 'done' ? 'pending' : 'done' }),
    })
    mutate()
  }

  async function deleteTask(id: string) {
    if (!confirm('Bu görevi silmek istediğinizden emin misiniz?')) return
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
    mutate()
  }

  function openAdd(date: string) {
    setEditTask(null)
    setDialogDate(date)
    setDialogOpen(true)
  }

  function openEdit(task: Task) {
    setEditTask(task)
    setDialogDate(task.date)
    setDialogOpen(true)
  }

  function scrollToDay(dateStr: string) {
    const el = document.getElementById(`day-${dateStr}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // Scroll to today on mount
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      setTimeout(() => scrollToDay(todayStr), 100)
    }
  }, [todayStr])

  // Total stats
  const total = tasks?.length ?? 0
  const doneCount = tasks?.filter(t => t.status === 'done').length ?? 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-8 pt-8 pb-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <CalendarDays size={22} className="text-indigo-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Takvim</h1>
              {total > 0 && (
                <p className="text-zinc-500 text-xs mt-0.5">{doneCount}/{total} görev tamamlandı</p>
              )}
            </div>
          </div>
          <button
            onClick={() => openAdd(todayStr)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            <Plus size={15} /> Görev Ekle
          </button>
        </div>

        {/* ── Week strip ── */}
        <div
          className="rounded-2xl p-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setWeekOffset(w => Math.max(0, w - 1))}
              disabled={weekOffset === 0}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all disabled:opacity-20"
            >
              <ChevronLeft size={16} />
            </button>

            <div className="flex-1 grid grid-cols-7 gap-1">
              {stripDates.map(d => {
                const dayTasks = tasksByDate[d] || []
                const hasPending = dayTasks.some(t => t.status === 'pending')
                const allDone = dayTasks.length > 0 && dayTasks.every(t => t.status === 'done')
                const isToday = d === todayStr
                const dt = new Date(d + 'T12:00:00')
                return (
                  <button
                    key={d}
                    onClick={() => scrollToDay(d)}
                    className="flex flex-col items-center gap-1 py-2 rounded-xl transition-all hover:bg-white/8"
                    style={isToday ? { background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)' } : {}}
                  >
                    <span className={`text-[10px] font-medium uppercase tracking-wide ${isToday ? 'text-indigo-300' : 'text-zinc-500'}`}>
                      {TR_DAYS[dt.getDay()]}
                    </span>
                    <span className={`text-sm font-semibold ${isToday ? 'text-white' : 'text-zinc-300'}`}>
                      {dt.getDate()}
                    </span>
                    <span className="h-1.5 w-1.5 rounded-full" style={{
                      background: allDone ? '#4ade80' : hasPending ? '#fbbf24' : 'transparent'
                    }} />
                  </button>
                )
              })}
            </div>

            <button
              onClick={() => setWeekOffset(w => w + 1)}
              disabled={stripStart + 7 >= VISIBLE_DAYS}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-white/10 transition-all disabled:opacity-20"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Day list ── */}
      <div className="flex-1 overflow-y-auto px-8 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-zinc-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {dates.map(dateStr => {
              const dayTasks = (tasksByDate[dateStr] || []).sort((a, b) => a.time.localeCompare(b.time))
              return (
                <DaySection
                  key={dateStr}
                  dateStr={dateStr}
                  todayStr={todayStr}
                  tasks={dayTasks}
                  onAdd={openAdd}
                  onEdit={openEdit}
                  onToggle={toggleDone}
                  onDelete={deleteTask}
                />
              )
            })}
          </div>
        )}
      </div>

      {/* ── Dialog ── */}
      {dialogOpen && (
        <TaskDialog
          task={editTask}
          defaultDate={dialogDate}
          onClose={() => { setDialogOpen(false); setEditTask(null) }}
          onSave={() => mutate()}
        />
      )}
    </div>
  )
}
