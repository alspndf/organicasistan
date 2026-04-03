import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { nowHH } from '@/lib/utils'

export async function POST(req: Request) {
  const secret = req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = nowHH()

  // Find email connections whose check time matches the current hour:minute
  const connections = await prisma.emailConnection.findMany({
    where: { checkTime: now },
    include: { user: { include: { settings: true } } },
  })

  const results = []
  for (const conn of connections) {
    try {
      // Trigger email fetch for this user
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
      const res = await fetch(`${baseUrl}/api/email/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-user-id': conn.userId, // internal header for cron
        },
      })
      const data = await res.json()
      results.push({ userId: conn.userId, ok: true, items: data.actionItems?.length ?? 0 })
    } catch (e) {
      results.push({ userId: conn.userId, ok: false })
    }
  }

  return NextResponse.json({ ok: true, checked: results.length, results })
}
