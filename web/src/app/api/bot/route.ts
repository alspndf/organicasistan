import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/encryption'
import { startBot, stopBot, getBotStatus } from '@/lib/bot-manager'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(getBotStatus(session.user.id as string))
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action } = await req.json()

  if (action === 'stop') {
    return NextResponse.json(stopBot(session.user.id as string))
  }

  if (action === 'start') {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: session.user.id as string },
    })

    const user = await prisma.user.findUnique({ where: { id: session.user.id as string } })

    const env: Record<string, string> = {
      WEB_APP_URL:  process.env.NEXTAUTH_URL || 'http://localhost:3000',
      BOT_SECRET:   process.env.BOT_SECRET  || 'organic-bot-internal',
      WEB_USER_ID:        session.user.id as string,
      BOT_USER_NAME:      settings?.userName || user?.name || 'Kullanıcı',
      BOT_ASSISTANT_NAME: settings?.assistantName || 'Yeliz',
    }

    // Telegram token: settings first, then .env fallback
    const token = settings?.telegramToken || process.env.TELEGRAM_BOT_TOKEN
    if (token) env.TELEGRAM_BOT_TOKEN = token

    // Chat ID
    const chatId = settings?.telegramChatId || process.env.TELEGRAM_CHAT_ID
    if (chatId) env.TELEGRAM_CHAT_ID = chatId

    // Anthropic key: decrypt from settings, else .env fallback
    if (settings?.anthropicKeyEnc) {
      try { env.ANTHROPIC_API_KEY = decrypt(settings.anthropicKeyEnc) } catch { /* ignore */ }
    }
    if (!env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY) {
      env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    }

    const missing = []
    if (!env.TELEGRAM_BOT_TOKEN) missing.push('Telegram Bot Token')
    if (!env.TELEGRAM_CHAT_ID)   missing.push('Telegram Chat ID')
    if (!env.ANTHROPIC_API_KEY)  missing.push('Anthropic API Anahtarı')

    if (missing.length) {
      return NextResponse.json(
        { ok: false, error: `Eksik ayarlar: ${missing.join(', ')}` },
        { status: 400 },
      )
    }

    return NextResponse.json(startBot(env, session.user.id as string))
  }

  return NextResponse.json({ error: 'Geçersiz işlem.' }, { status: 400 })
}
