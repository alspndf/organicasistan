'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Plus, X, Loader2 } from 'lucide-react'

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_LABELS: Record<string, string> = {
  sun: 'Pazar',
  mon: 'Pazartesi',
  tue: 'Salı',
  wed: 'Çarşamba',
  thu: 'Perşembe',
  fri: 'Cuma',
  sat: 'Cumartesi',
}

interface DaySchedule {
  dayKey: string
  activities: string[]
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

function getTodayKey(): string {
  return DAY_KEYS[new Date().getDay()]
}

export default function SchedulePage() {
  const { data, mutate, isLoading } = useSWR<DaySchedule[]>('/api/schedule', fetcher)
  const [scheduleMap, setScheduleMap] = useState<Record<string, string[]>>({})
  const [newActivity, setNewActivity] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})

  const todayKey = getTodayKey()

  useEffect(() => {
    if (data) {
      const map: Record<string, string[]> = {}
      for (const day of DAY_KEYS) map[day] = []
      for (const item of data) map[item.dayKey] = item.activities
      setScheduleMap(map)
    }
  }, [data])

  async function saveDay(dayKey: string, activities: string[]) {
    setSaving(prev => ({ ...prev, [dayKey]: true }))
    try {
      await fetch(`/api/schedule/${dayKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activities }),
      })
      mutate()
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(prev => ({ ...prev, [dayKey]: false }))
    }
  }

  function addActivity(dayKey: string) {
    const val = newActivity[dayKey]?.trim()
    if (!val) return

    const updated = [...(scheduleMap[dayKey] || []), val]
    setScheduleMap(prev => ({ ...prev, [dayKey]: updated }))
    setNewActivity(prev => ({ ...prev, [dayKey]: '' }))
    saveDay(dayKey, updated)
  }

  function removeActivity(dayKey: string, idx: number) {
    const updated = (scheduleMap[dayKey] || []).filter((_, i) => i !== idx)
    setScheduleMap(prev => ({ ...prev, [dayKey]: updated }))
    saveDay(dayKey, updated)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 size={28} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Haftalık Program</h1>
        <p className="text-zinc-500 text-sm mt-0.5">Her gün için tekrar eden aktivitelerinizi ayarlayın</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {DAY_KEYS.map(dayKey => {
          const isToday = dayKey === todayKey
          const activities = scheduleMap[dayKey] || []
          const isSaving = saving[dayKey]

          return (
            <div
              key={dayKey}
              className="rounded-2xl p-5"
              style={{
                background: isToday
                  ? 'rgba(59,130,246,0.07)'
                  : 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(12px)',
                border: isToday
                  ? '1px solid rgba(59,130,246,0.3)'
                  : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {/* Day header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className={`font-semibold text-sm ${isToday ? 'text-blue-400' : 'text-white'}`}>
                  {DAY_LABELS[dayKey]}
                  {isToday && (
                    <span className="ml-2 text-xs font-normal text-blue-500">bugün</span>
                  )}
                </h3>
                {isSaving && <Loader2 size={12} className="animate-spin text-zinc-500" />}
              </div>

              {/* Activity chips */}
              <div className="flex flex-wrap gap-2 mb-3 min-h-8">
                {activities.map((act, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium text-zinc-300 group"
                    style={{
                      background: 'rgba(255,255,255,0.08)',
                      border: '1px solid rgba(255,255,255,0.1)',
                    }}
                  >
                    {act}
                    <button
                      onClick={() => removeActivity(dayKey, i)}
                      className="text-zinc-600 hover:text-red-400 transition-colors ml-0.5"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
                {activities.length === 0 && (
                  <span className="text-zinc-700 text-xs">Aktivite yok</span>
                )}
              </div>

              {/* Add activity */}
              <div className="flex gap-2 mt-auto">
                <input
                  type="text"
                  value={newActivity[dayKey] || ''}
                  onChange={e => setNewActivity(prev => ({ ...prev, [dayKey]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addActivity(dayKey) }}
                  placeholder="Aktivite ekle..."
                  className="flex-1 px-3 py-1.5 rounded-lg text-white placeholder-zinc-600 text-xs outline-none focus:ring-1 focus:ring-blue-500/40 transition-all min-w-0"
                  style={{
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                />
                <button
                  onClick={() => addActivity(dayKey)}
                  disabled={!newActivity[dayKey]?.trim()}
                  className="p-1.5 rounded-lg text-white transition-all disabled:opacity-30 flex-shrink-0"
                  style={{ background: 'rgba(59,130,246,0.4)' }}
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
