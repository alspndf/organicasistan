import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'
  return secret === botSecret
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

  const routines = await prisma.dailyRoutine.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(routines)
}

export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const { text, time } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const routine = await prisma.dailyRoutine.create({
    data: { userId, text: text.trim(), time: time || null },
  })

  return NextResponse.json(routine, { status: 201 })
}
