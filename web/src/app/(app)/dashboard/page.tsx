import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { today } from '@/lib/utils'
import TodayPlanCard from '@/components/dashboard/TodayPlanCard'
import QuickAddTask from '@/components/dashboard/QuickAddTask'

const TR_DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

function CompletionRing({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)
  const r = 36
  const circ = 2 * Math.PI * r
  const offset = circ - (pct / 100) * circ

  return (
    <div
      className="flex flex-col items-center justify-center p-6 rounded-2xl"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.08)',
        minWidth: 160,
      }}
    >
      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke="url(#grad)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 0.6s ease' }}
          />
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute text-center">
          <span className="text-white font-bold text-xl">{pct}%</span>
        </div>
      </div>
      <p className="text-zinc-400 text-sm mt-2">{done}/{total} tamamlandı</p>
    </div>
  )
}

async function getWeeklyBadges(userId: string): Promise<string[]> {
  const now = new Date()
  const dayIndex = now.getDay()
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayIndex]

  const schedule = await prisma.weeklySchedule.findUnique({
    where: { userId_dayKey: { userId, dayKey } },
  })

  if (!schedule) return []
  try {
    return JSON.parse(schedule.activities)
  } catch {
    return []
  }
}

export default async function DashboardPage() {
  const session = await auth()
  const userId = (session!.user as { id: string }).id

  const todayStr = today()
  const nowDate = new Date()
  const dayName = TR_DAYS[nowDate.getDay()]
  const dateLabel = `${nowDate.getDate()} ${TR_MONTHS[nowDate.getMonth()]} ${nowDate.getFullYear()}`

  const tasks = await prisma.task.findMany({
    where: { userId, date: todayStr },
    orderBy: { time: 'asc' },
  })

  const done = tasks.filter(t => t.status === 'done').length
  const total = tasks.length

  const weeklyBadges = await getWeeklyBadges(userId)

  // Future tasks grouped by date
  const futureTasks = await prisma.task.findMany({
    where: { userId, date: { gt: todayStr }, status: 'pending' },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
    take: 20,
  })

  const futureByDate: Record<string, typeof futureTasks> = {}
  for (const t of futureTasks) {
    if (!futureByDate[t.date]) futureByDate[t.date] = []
    futureByDate[t.date].push(t)
  }

  const serializedTasks = tasks.map(t => ({
    id: t.id,
    userId: t.userId,
    title: t.title,
    time: t.time,
    date: t.date,
    status: t.status as 'pending' | 'done' | 'skipped',
    priority: t.priority as 'high' | 'medium' | 'low',
    source: t.source as 'web' | 'telegram' | 'email',
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  }))

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <p className="text-zinc-500 text-sm mb-1">{dayName}</p>
        <h1 className="text-3xl font-bold text-white">{dateLabel}</h1>
      </div>

      {/* Weekly badges */}
      {weeklyBadges.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {weeklyBadges.map((badge, i) => (
            <span
              key={i}
              className="px-3 py-1 rounded-full text-xs font-medium text-purple-300"
              style={{
                background: 'rgba(167,139,250,0.15)',
                border: '1px solid rgba(167,139,250,0.25)',
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {/* Stats + Plan */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Completion ring */}
        <div className="flex flex-col gap-4">
          <CompletionRing done={done} total={total} />
        </div>

        {/* Today's plan */}
        <div className="lg:col-span-2">
          <TodayPlanCard initialTasks={serializedTasks} todayDate={todayStr} />
        </div>
      </div>

      {/* Quick add */}
      <div className="mt-6">
        <QuickAddTask todayDate={todayStr} />
      </div>

      {/* Future tasks */}
      {Object.keys(futureByDate).length > 0 && (
        <div className="mt-8">
          <h2 className="text-white font-semibold text-lg mb-4">İleri Tarihler</h2>
          <div className="space-y-4">
            {Object.entries(futureByDate).map(([date, dateTasks]) => {
              const d = new Date(date + 'T00:00:00')
              const label = `${d.getDate()} ${TR_MONTHS[d.getMonth()]} ${d.getFullYear()} — ${TR_DAYS[d.getDay()]}`
              return (
                <div
                  key={date}
                  className="rounded-2xl p-5"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                  }}
                >
                  <p className="text-zinc-400 text-sm font-medium mb-3">{label}</p>
                  <div className="space-y-2">
                    {dateTasks.map(t => (
                      <div key={t.id} className="flex items-center gap-3">
                        <span className="text-zinc-600 text-xs w-12 shrink-0">{t.time}</span>
                        <span className="text-zinc-300 text-sm">{t.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
