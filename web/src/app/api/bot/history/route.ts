import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  return secret === (process.env.BOT_SECRET || 'organic-bot-internal')
}

async function getBotUserId(req: NextRequest): Promise<string | null> {
  const userId = req.headers.get('x-bot-user-id')
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user?.id ?? null
}

export async function GET(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const record = await prisma.memory.findUnique({
    where: { userId_type_key: { userId, type: 'bot', key: 'conversation_history' } },
  })

  if (!record) return NextResponse.json([])

  try {
    return NextResponse.json(JSON.parse(record.value))
  } catch {
    return NextResponse.json([])
  }
}

export async function PUT(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const messages = await req.json()

  await prisma.memory.upsert({
    where: { userId_type_key: { userId, type: 'bot', key: 'conversation_history' } },
    create: { userId, type: 'bot', key: 'conversation_history', value: JSON.stringify(messages) },
    update: { value: JSON.stringify(messages) },
  })

  return NextResponse.json({ ok: true })
}
