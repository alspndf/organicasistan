import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  const connection = await prisma.emailConnection.findUnique({ where: { userId } })

  if (!connection) {
    return NextResponse.json({
      connected: false,
      lastChecked: null,
      checkTime: '08:30',
      provider: 'gmail',
    })
  }

  return NextResponse.json({
    connected: true,
    lastChecked: connection.lastChecked?.toISOString() || null,
    checkTime: connection.checkTime,
    provider: connection.provider,
  })
}
