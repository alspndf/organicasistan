import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { today, parseTime } from '@/lib/utils'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || today()

  const tasks = await prisma.task.findMany({
    where: { userId, date },
    orderBy: { time: 'asc' },
  })

  return NextResponse.json(tasks)
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date') || today()

  try {
    const result = await prisma.task.deleteMany({ where: { userId, date } })
    return NextResponse.json({ ok: true, deleted: result.count })
  } catch (err) {
    console.error('[tasks DELETE] error:', err)
    return NextResponse.json({ error: 'Görevler silinemedi.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  try {
    const body = await req.json()
    const { title, time, date, priority } = body

    if (!title || !title.trim()) {
      return NextResponse.json({ error: 'Görev başlığı zorunludur.' }, { status: 400 })
    }

    const parsedTime = parseTime(time)
    if (!parsedTime) {
      return NextResponse.json({ error: 'Geçersiz saat formatı. HH:MM kullanın.' }, { status: 400 })
    }

    const task = await prisma.task.create({
      data: {
        userId,
        title: title.trim(),
        time: parsedTime,
        date: date || today(),
        priority: priority || 'medium',
        status: 'pending',
        source: 'web',
      },
    })

    return NextResponse.json(task, { status: 201 })
  } catch (err) {
    console.error('[tasks POST] error:', err)
    return NextResponse.json({ error: 'Görev oluşturulamadı.' }, { status: 500 })
  }
}
