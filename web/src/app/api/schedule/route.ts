import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  const rows = await prisma.weeklySchedule.findMany({
    where: { userId },
  })

  const result = rows.map(row => {
    let activities: string[] = []
    try {
      activities = JSON.parse(row.activities)
    } catch {
      activities = []
    }
    return { dayKey: row.dayKey, activities }
  })

  return NextResponse.json(result)
}
