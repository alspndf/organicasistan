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

// GET /api/cron/reminders — diagnostic snapshot
export async function GET(req: Request) {
  const tz      = DEFAULT_TZ
  const today   = todayInTz(tz)
  const now     = nowHHInTz(tz)
  const target  = addMins(now, PRE_REMIND)

  const [totalTasks, todayTasks, recentTasks, users] = await Promise.all([
    prisma.task.count(),
    prisma.task.findMany({ where: { date: today }, orderBy: { time: 'asc' } }),
    prisma.task.findMany({ take: 5, orderBy: { createdAt: 'desc' } }),
    prisma.userSettings.findMany({
      where: { notifyTelegram: true, telegramToken: { not: null }, telegramChatId: { not: null } },
      select: { userId: true, telegramChatId: true, timezone: true },
    }),
  ])

  return NextResponse.json({
    serverTime:   { utc: new Date().toISOString(), tz, today, now, targetTime: target },
    db:           { totalTasks, todayCount: todayTasks.length },
    todayTasks:   todayTasks.map(t => ({ id: t.id, userId: t.userId, time: t.time, status: t.status, title: t.title, date: t.date })),
    recentTasks:  recentTasks.map(t => ({ id: t.id, userId: t.userId, date: t.date, time: t.time, title: t.title, createdAt: t.createdAt })),
    users:        users.map(u => ({ userId: u.userId, telegramChatId: u.telegramChatId ? 'dolu' : 'BOŞ', timezone: u.timezone })),
    userIdMatch:  users.length && recentTasks.length ? users.some(u => u.userId === recentTasks[0].userId) : null,
  })
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

  console.log(`[DEBUG] UTC: ${new Date().toISOString()} | ${DEFAULT_TZ}: ${nowHHInTz(DEFAULT_TZ)} | tarih: ${todayInTz(DEFAULT_TZ)}`)
  console.log(`[USER] Telegram ayarlı kullanıcı sayısı: ${users.length}`)
  for (const u of users) {
    console.log(`[USER] userId=${u.userId}`)
  }
  const totalTasks = await prisma.task.count()
  console.log(`[TASKS] DB toplam görev: ${totalTasks}`)
  const sampleTasks = await prisma.task.findMany({ take: 2, orderBy: { createdAt: 'desc' } })
  for (const t of sampleTasks) {
    console.log(`[TASK ÖRNEK] userId=${t.userId} | date=${t.date} | time=${t.time} | title="${t.title}"`)
  }
  // userId eşleşiyor mu?
  if (users.length && sampleTasks.length) {
    const match = users.some(u => u.userId === sampleTasks[0].userId)
    console.log(`[USERID MATCH] UserSettings.userId === Task.userId: ${match}`)
  }

  // timezone yanlışsa düzelt
  for (const u of users) {
    if (u.timezone !== DEFAULT_TZ) {
      await prisma.userSettings.update({ where: { userId: u.userId }, data: { timezone: DEFAULT_TZ } })
      console.log(`[USER] timezone güncellendi: ${u.timezone} → ${DEFAULT_TZ} (userId=${u.userId})`)
    }
    const todayTasks = await prisma.task.findMany({
      where: { date: todayInTz(DEFAULT_TZ), status: 'pending' },
      orderBy: { time: 'asc' },
    })
    console.log(`[TASKS] bugün (${todayInTz(DEFAULT_TZ)}) görev sayısı: ${todayTasks.length}`)
    for (const t of todayTasks) {
      console.log(`[TASKS] time="${t.time}" | status=${t.status} | title="${t.title}"`)
    }
  }

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
      where: { date: today, status: 'pending', time: targetTime },
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
