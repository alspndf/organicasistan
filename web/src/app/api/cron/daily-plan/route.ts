import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { today } from '@/lib/utils'

export async function POST(req: Request) {
  // Simple secret check
  const secret = req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const date = today()
  const dayNames = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
  const dayName = dayNames[new Date().getDay()]

  // Get all users with Telegram notifications enabled
  const settings = await prisma.userSettings.findMany({
    where: { notifyTelegram: true, NOT: { telegramToken: null, telegramChatId: null } },
    include: { user: { include: { tasks: { where: { date } } } } },
  })

  const results = []
  for (const s of settings) {
    const tasks = s.user.tasks
    if (!tasks.length) continue

    const sorted = tasks.sort((a, b) => a.time.localeCompare(b.time))
    const lines = [`📅 ${dayName} - Günün planı:`, '']
    sorted.forEach((t) => lines.push(`⏳ ${t.time} — ${t.title}`))

    // Send via Telegram if configured
    if (s.telegramToken && s.telegramChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: s.telegramChatId, text: lines.join('\n') }),
        })
        results.push({ userId: s.userId, sent: true })
      } catch {
        results.push({ userId: s.userId, sent: false })
      }
    }
  }

  return NextResponse.json({ ok: true, date, results })
}
