'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Circle, Clock } from 'lucide-react'
import type { Task } from '@/types'

interface TodayPlanCardProps {
  initialTasks: Task[]
  todayDate: string
}

export default function TodayPlanCard({ initialTasks, todayDate }: TodayPlanCardProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function toggleDone(task: Task) {
    const newStatus = task.status === 'done' ? 'pending' : 'done'
    setLoadingId(task.id)

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (res.ok) {
        setTasks(prev =>
          prev.map(t => (t.id === task.id ? { ...t, status: newStatus } : t))
        )
        router.refresh()
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingId(null)
    }
  }

  if (tasks.length === 0) {
    return (
      <div
        className="rounded-2xl p-6 h-full flex flex-col items-center justify-center min-h-40"
        style={{
          background: 'rgba(255,255,255,0.04)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        <p className="text-zinc-500 text-sm text-center">
          Henüz görev yok. Görev eklemek için aşağıdaki formu kullanın.
        </p>
      </div>
    )
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
        <Clock size={15} className="text-zinc-400" />
        Bugünün Planı
      </h2>

      <div className="space-y-2">
        {tasks.map(task => {
          const isDone = task.status === 'done'
          const isLoading = loadingId === task.id

          return (
            <div
              key={task.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                isDone ? 'opacity-50' : ''
              }`}
              style={{
                background: isDone
                  ? 'rgba(255,255,255,0.02)'
                  : 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Time badge */}
              <span
                className="text-xs font-mono font-medium px-2 py-0.5 rounded-md flex-shrink-0"
                style={{
                  background: 'rgba(59,130,246,0.15)',
                  color: '#60a5fa',
                }}
              >
                {task.time}
              </span>

              {/* Title */}
              <span
                className={`flex-1 text-sm ${isDone ? 'line-through text-zinc-600' : 'text-white'}`}
              >
                {task.title}
              </span>

              {/* Priority indicator */}
              {task.priority === 'high' && !isDone && (
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
              )}

              {/* Done button */}
              <button
                onClick={() => toggleDone(task)}
                disabled={isLoading}
                className="flex-shrink-0 transition-all disabled:opacity-40"
                title={isDone ? 'Tamamlandıyı geri al' : 'Tamamlandı olarak işaretle'}
              >
                {isDone ? (
                  <CheckCircle2 size={18} className="text-green-400" />
                ) : (
                  <Circle size={18} className="text-zinc-600 hover:text-yellow-400" />
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
