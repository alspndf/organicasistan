import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { today, nowHH } from '@/lib/utils'

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowHH()
  const date = today()

  const due = await prisma.reminder.findMany({
    where: { date, sent: false, remindAt: { lte: now } },
    include: {
      user: { include: { settings: true } },
    },
  })

  const fired = []
  for (const r of due) {
    await prisma.reminder.update({ where: { id: r.id }, data: { sent: true } })

    const settings = r.user.settings
    if (settings?.telegramToken && settings?.telegramChatId) {
      try {
        await fetch(`https://api.telegram.org/bot${settings.telegramToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: settings.telegramChatId,
            text: `🔔 Hatırlatma: ${r.message}`,
          }),
        })
      } catch {
        // ignore send errors
      }
    }
    fired.push(r.id)
  }

  return NextResponse.json({ ok: true, fired })
}
