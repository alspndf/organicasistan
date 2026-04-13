'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { CalendarCheck, ChevronLeft, ChevronRight, MapPin, Clock, Link2, Loader2 } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then(r => r.json())

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' })
}

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

function todayStr() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Istanbul' })
}

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  location: string | null
  allDay: boolean
}

export default function GoogleCalendarPage() {
  const [date, setDate] = useState(todayStr)

  const { data: status } = useSWR<{ connected: boolean; email?: string }>('/api/calendar/status', fetcher)
  const { data: events, isLoading, error } = useSWR<CalendarEvent[] | { error: string }>(
    status?.connected ? `/api/calendar/events?date=${date}` : null,
    fetcher
  )

  const eventList = Array.isArray(events) ? events : []
  const isToday = date === todayStr()

  if (!status) {
    return (
      <div className="p-8 flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-zinc-500" />
      </div>
    )
  }

  if (!status.connected) {
    return (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-white mb-2">Google Takvim</h1>
        <p className="text-zinc-500 text-sm mb-8">Google hesabınızı bağlayarak etkinliklerinizi görün</p>
        <div
          className="rounded-2xl p-10 text-center max-w-md"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <CalendarCheck size={40} className="mx-auto text-zinc-600 mb-4" />
          <p className="text-white font-medium mb-2">Google Takvim bağlı değil</p>
          <p className="text-zinc-500 text-sm mb-6">Etkinliklerinizi görmek için Google hesabınızı bağlayın</p>
          <a
            href="/api/calendar/auth"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-medium"
            style={{ background: 'linear-gradient(135deg, #3b82f6, #6366f1)' }}
          >
            <Link2 size={15} />
            Google ile Bağla
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Google Takvim</h1>
          {status.email && <p className="text-zinc-500 text-sm mt-0.5">{status.email}</p>}
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => setDate(d => addDays(d, -1))}
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ChevronLeft size={16} />
        </button>

        <div className="flex-1 text-center">
          <p className="text-white font-semibold capitalize">{formatDate(date)}</p>
          {isToday && <p className="text-blue-400 text-xs mt-0.5">Bugün</p>}
        </div>

        <button
          onClick={() => setDate(d => addDays(d, 1))}
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/5 transition-all"
          style={{ border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {!isToday && (
        <button
          onClick={() => setDate(todayStr())}
          className="mb-4 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← Bugüne dön
        </button>
      )}

      {/* Events */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-zinc-500" />
        </div>
      ) : error || (events && !Array.isArray(events)) ? (
        <div
          className="rounded-2xl p-8 text-center"
          style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)' }}
        >
          <p className="text-red-400 text-sm">Etkinlikler yüklenemedi. Token süresi dolmuş olabilir.</p>
          <a href="/api/calendar/auth" className="mt-3 inline-block text-xs text-blue-400 hover:underline">
            Yeniden bağlan
          </a>
        </div>
      ) : eventList.length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <p className="text-zinc-500 text-sm">Bu tarihte etkinlik yok.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {eventList.map(event => (
            <div
              key={event.id}
              className="flex items-start gap-4 px-5 py-4 rounded-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ background: 'linear-gradient(180deg, #3b82f6, #6366f1)' }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium">{event.title}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {!event.allDay && (
                    <span className="flex items-center gap-1 text-xs text-blue-400">
                      <Clock size={11} />
                      {event.start}{event.end ? ` — ${event.end}` : ''}
                    </span>
                  )}
                  {event.allDay && (
                    <span className="text-xs text-zinc-500">Tüm gün</span>
                  )}
                  {event.location && (
                    <span className="flex items-center gap-1 text-xs text-zinc-500">
                      <MapPin size={11} />
                      {event.location}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
