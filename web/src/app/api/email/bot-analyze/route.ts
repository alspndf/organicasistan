import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRecentEmails } from '@/lib/gmail'
import { analyzeEmails } from '@/lib/email-analyzer'

// Internal endpoint for the Telegram bot to trigger email analysis
// Protected by BOT_SECRET env var
export async function POST(req: Request) {
  const secret = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'

  if (secret !== botSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get the first user (single-user bot mode)
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) {
    return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 })
  }

  const connection = await prisma.emailConnection.findUnique({ where: { userId: user.id } })
  if (!connection) {
    return NextResponse.json({ error: 'E-posta hesabı bağlı değil.' }, { status: 400 })
  }

  try {
    const emails = await getRecentEmails(user.id, 15)
    const result = await analyzeEmails(emails, user.id)

    await prisma.emailConnection.update({
      where: { userId: user.id },
      data: { lastChecked: new Date() },
    })

    return NextResponse.json({ ...result, emailCount: emails.length })
  } catch (err) {
    console.error('[bot-analyze] error:', err)
    return NextResponse.json({ error: 'E-postalar analiz edilemedi.' }, { status: 500 })
  }
}
