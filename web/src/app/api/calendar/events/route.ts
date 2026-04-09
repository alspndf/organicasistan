import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getCalendarEvents } from '@/lib/google-calendar'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await prisma.googleCalendarToken.findUnique({ where: { userId: session.user.id } })
  if (!token) return NextResponse.json({ error: 'not_connected' }, { status: 404 })

  const date = req.nextUrl.searchParams.get('date') || new Date().toISOString().split('T')[0]

  try {
    const events = await getCalendarEvents(token.accessToken, token.refreshToken, date)
    return NextResponse.json(events)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.googleCalendarToken.deleteMany({ where: { userId: session.user.id } })
  return NextResponse.json({ ok: true })
}
