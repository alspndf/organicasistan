import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = session.user.id

  await prisma.$transaction([
    prisma.task.deleteMany({ where: { userId } }),
    prisma.dailyRoutine.deleteMany({ where: { userId } }),
    prisma.memory.deleteMany({ where: { userId } }),
  ])

  return NextResponse.json({ ok: true })
}
