import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'
  return secret === botSecret
}

async function getBotUser(req: NextRequest) {
  const userId = req.headers.get('x-bot-user-id')
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (user) return user
  }
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
}

export async function GET(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getBotUser(req)
  if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

  const routines = await prisma.dailyRoutine.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(routines)
}

export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getBotUser(req)
  if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

  const { text, time } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const routine = await prisma.dailyRoutine.create({
    data: { userId: user.id, text: text.trim(), time: time || null },
  })

  return NextResponse.json(routine, { status: 201 })
}
