import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

const DEFAULT_TZ  = process.env.BOT_TIMEZONE || 'Asia/Ho_Chi_Minh'
const PRE_REMIND  = 10 // minutes before task time

function todayInTz(tz: string): string {
  // sv-SE locale gives "YYYY-MM-DD"
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz })
}

function nowHHInTz(tz: string): string {
  // sv-SE locale gives "HH:MM:SS" in 24h
  return new Date().toLocaleTimeString('sv-SE', { timeZone: tz }).slice(0, 5)
}

function addMins(hhmm: string, n: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const t = ((h * 60 + m + n) % 1440 + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const users = await prisma.userSettings.findMany({
    where: { notifyTelegram: true, telegramToken: { not: null }, telegramChatId: { not: null } },
    select: { userId: true, timezone: true, telegramToken: true, telegramChatId: true },
  })

  const fired: { taskId: string; title: string; time: string }[] = []

  for (const s of users) {
    // BOT_TIMEZONE env var takes priority — DB default is 'Europe/Istanbul' which may not match
    const tz      = DEFAULT_TZ || s.timezone
    const today   = todayInTz(tz)
    const now     = nowHHInTz(tz)
    // Tasks that start in exactly PRE_REMIND minutes from now
    const targetTime = addMins(now, PRE_REMIND)

    console.log(`[REMINDER] Kontrol: şu an ${now} | hedef görev saati ${targetTime} | tarih ${today} | tz ${tz}`)

    const tasks = await prisma.task.findMany({
      where: { userId: s.userId, date: today, status: 'pending', time: targetTime },
    })

    console.log(`[REMINDER] Bulunan görev sayısı: ${tasks.length}`)

    for (const task of tasks) {
      // Deduplication: skip if already reminded today
      const existing = await prisma.reminder.findFirst({
        where: { taskId: task.id, date: today, sent: true },
      })
      if (existing) {
        console.log(`[REMINDER] Zaten gönderildi, atlanıyor: ${task.title}`)
        continue
      }

      // Mark as sent before sending (prevents double-fire on retry)
      await prisma.reminder.create({
        data: {
          userId:   s.userId,
          taskId:   task.id,
          message:  task.title,
          remindAt: now,
          date:     today,
          sent:     true,
          channel:  'telegram',
        },
      })

      try {
        await fetch(`https://api.telegram.org/bot${s.telegramToken}/sendMessage`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: s.telegramChatId,
            text:    `🔔 ${task.time} → ${task.title} — 10 dakikan var.`,
          }),
        })
        fired.push({ taskId: task.id, title: task.title, time: task.time })
        console.log(`[REMINDER] Gönderildi: ${task.title} (${task.time})`)
      } catch (e: unknown) {
        console.error('[REMINDER] Telegram gönderme hatası:', e instanceof Error ? e.message : e)
      }
    }
  }

  return NextResponse.json({ ok: true, fired })
}
