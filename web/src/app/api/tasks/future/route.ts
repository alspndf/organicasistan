import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { today } from '@/lib/utils'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tasks = await prisma.task.findMany({
    where: {
      userId: session.user.id as string,
      date: { gt: today() },
      status: 'pending',
    },
    orderBy: [{ date: 'asc' }, { time: 'asc' }],
  })

  return NextResponse.json(tasks)
}
