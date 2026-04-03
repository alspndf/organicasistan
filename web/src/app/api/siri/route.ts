import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { classifyMessage } from '@/lib/claude'
import { executeIntent } from '@/lib/task-engine'
import { today } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-siri-secret') || ''
  if (!secret || secret !== process.env.SIRI_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message } = await req.json()
  if (!message?.trim()) {
    return NextResponse.json({ error: 'Mesaj boş.' }, { status: 400 })
  }

  // Find the first user (single-user setup) or use SIRI_USER_EMAIL
  const email = process.env.SIRI_USER_EMAIL
  const user = email
    ? await prisma.user.findUnique({ where: { email } })
    : await prisma.user.findFirst()

  if (!user) {
    return NextResponse.json({ error: 'Kullanıcı bulunamadı.' }, { status: 404 })
  }

  const dateStr = today()
  const decision = await classifyMessage(message.trim(), user.id, dateStr)
  const response = await executeIntent(decision, user.id, dateStr)

  // Send response via Telegram if configured
  const settings = await prisma.userSettings.findUnique({ where: { userId: user.id } })
  if (settings?.telegramToken && settings?.telegramChatId) {
    const token = settings.telegramToken
    const chatId = settings.telegramChatId
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: response }),
    }).catch(() => null)
  }

  return NextResponse.json({ response })
}
