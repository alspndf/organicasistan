import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'
  return secret === botSecret
}

async function getBotUser() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
}

export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getBotUser()
  if (!user) return NextResponse.json({ error: 'No user found' }, { status: 404 })

  const { text, time } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const routine = await prisma.dailyRoutine.create({
    data: { userId: user.id, text: text.trim(), time: time || null },
  })

  return NextResponse.json(routine, { status: 201 })
}
