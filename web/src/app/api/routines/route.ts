import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const routines = await prisma.dailyRoutine.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json(routines)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { text, time } = await req.json()
  if (!text?.trim()) return NextResponse.json({ error: 'Metin boş olamaz.' }, { status: 400 })

  const routine = await prisma.dailyRoutine.create({
    data: {
      userId: session.user.id as string,
      text: text.trim(),
      time: time || null,
    },
  })

  return NextResponse.json(routine, { status: 201 })
}
