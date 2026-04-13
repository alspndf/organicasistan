import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getCalendarEvents } from '@/lib/google-calendar'

function isBotAuthorized(req: NextRequest) {
  return req.headers.get('x-bot-secret') === (process.env.BOT_SECRET || 'organic-bot-internal')
}

async function getBotUser(req: NextRequest) {
  const userId = req.headers.get('x-bot-user-id')
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (user) return user
  }
  return null
}

export async function GET(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await getBotUser(req)
  if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0]

  try {
    const events = await getCalendarEvents(user.id, date)
    return NextResponse.json(events)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
