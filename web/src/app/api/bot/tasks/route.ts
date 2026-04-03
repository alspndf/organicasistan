import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function isBotAuthorized(req: NextRequest) {
  const secret    = req.headers.get('x-bot-secret')
  const botSecret = process.env.BOT_SECRET || 'organic-bot-internal'
  return secret === botSecret
}

async function getBotUser() {
  return prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
}

// GET /api/bot/tasks?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0]
  const user = await getBotUser()
  if (!user) return NextResponse.json([])

  const tasks = await prisma.task.findMany({
    where: { userId: user.id, date, status: { not: 'done' } },
    orderBy: { time: 'asc' },
    select: { id: true, title: true, time: true, status: true },
  })

  return NextResponse.json(tasks)
}

// POST /api/bot/tasks — create or upsert a task
export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await getBotUser()
  if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

  const body = await req.json()
  const { id, title, time, date, status } = body
  const taskDate = date || new Date().toISOString().split('T')[0]

  const task = await prisma.task.upsert({
    where:  { id: id || '__new__' },
    update: { title, time, status: status || 'pending' },
    create: {
      id:       id || undefined,
      userId:   user.id,
      title,
      time,
      date:     taskDate,
      status:   status || 'pending',
      source:   'telegram',
    },
  })

  return NextResponse.json(task)
}

// PATCH /api/bot/tasks — update task status
export async function PATCH(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'id and status required' }, { status: 400 })

  await prisma.task.update({ where: { id }, data: { status } })
  return NextResponse.json({ ok: true })
}

// DELETE /api/bot/tasks?id=xxx
export async function DELETE(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  await prisma.task.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
