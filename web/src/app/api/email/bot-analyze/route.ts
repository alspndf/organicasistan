import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getRecentEmails, GmailAuthError } from '@/lib/gmail'
import { analyzeEmails } from '@/lib/email-analyzer'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'

  if (secret !== botSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Multi-user: prefer x-bot-user-id, fall back to first user
  let userId: string
  const headerUserId = req.headers.get('x-bot-user-id')
  if (headerUserId) {
    const user = await prisma.user.findUnique({ where: { id: headerUserId } })
    if (!user) return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 })
    userId = user.id
  } else {
    const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!user) return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 })
    userId = user.id
  }

  const connection = await prisma.emailConnection.findUnique({ where: { userId } })
  if (!connection || !connection.accessToken) {
    return NextResponse.json({
      error: 'Gmail hesabı bağlı değil. Ayarlar sayfasından Gmail\'i bağlayın.',
      errorType: 'not_connected',
    }, { status: 400 })
  }

  try {
    const emails = await getRecentEmails(userId, 15)
    const result = await analyzeEmails(emails, userId)

    await prisma.emailConnection.update({
      where: { userId },
      data: { lastChecked: new Date() },
    })

    return NextResponse.json({ ...result, emailCount: emails.length })
  } catch (err) {
    console.error('[bot-analyze] error:', err)

    if (err instanceof GmailAuthError) {
      return NextResponse.json({
        error: err.message,
        errorType: 'auth_expired',
      }, { status: 401 })
    }

    const msg = err instanceof Error ? err.message : 'Bilinmeyen hata'
    return NextResponse.json({
      error: `E-postalar analiz edilemedi: ${msg}`,
      errorType: 'unknown',
    }, { status: 500 })
  }
}
