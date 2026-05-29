import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret    = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'
  return secret === botSecret
}

async function getBotUserId(req: NextRequest): Promise<string | null> {
  const userId = req.headers.get('x-bot-user-id')
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user?.id ?? null
}

// GET /api/bot/tasks?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const tz   = process.env.BOT_TIMEZONE || 'Asia/Ho_Chi_Minh'
  const date = req.nextUrl.searchParams.get('date') || new Date().toLocaleDateString('sv-SE', { timeZone: tz })

  const tasks = await prisma.task.findMany({
    where: { userId, date },
    orderBy: { time: 'asc' },
    select: { id: true, title: true, time: true, status: true },
  })

  return NextResponse.json(tasks)
}

// POST /api/bot/tasks — create or upsert a task
export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const body = await req.json()
  const { id, title, time, date, status } = body
  const tz2      = process.env.BOT_TIMEZONE || 'Asia/Ho_Chi_Minh'
  const taskDate = date || new Date().toLocaleDateString('sv-SE', { timeZone: tz2 })

  const task = await prisma.task.upsert({
    where:  { id: id || '__new__' },
    update: { title, time, status: status || 'pending' },
    create: {
      id:       id || undefined,
      userId,
      title,
      time,
      date:     taskDate,
      status:   status || 'pending',
      source:   'telegram',
    },
  })

  return NextResponse.json(task)
}

// PATCH /api/bot/tasks — update task status (userId check ensures cross-user protection)
export async function PATCH(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const { id, status } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  await prisma.task.updateMany({ where: { id, userId }, data: { status } })
  return NextResponse.json({ ok: true })
}

// DELETE /api/bot/tasks?id=xxx
export async function DELETE(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = await getBotUserId(req)
  if (!userId) return NextResponse.json({ error: 'x-bot-user-id header required' }, { status: 400 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await prisma.task.deleteMany({ where: { id, userId } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
