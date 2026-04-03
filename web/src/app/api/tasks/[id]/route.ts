import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseTime } from '@/lib/utils'

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id as string

  const task = await prisma.task.findFirst({
    where: { id, userId },
  })

  if (!task) {
    return NextResponse.json({ error: 'Görev bulunamadı.' }, { status: 404 })
  }

  return NextResponse.json(task)
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id as string

  const existing = await prisma.task.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ error: 'Görev bulunamadı.' }, { status: 404 })
  }

  try {
    const body = await req.json()
    const updateData: Record<string, string> = {}

    if (body.title !== undefined) updateData.title = body.title.trim()
    if (body.status !== undefined) updateData.status = body.status
    if (body.priority !== undefined) updateData.priority = body.priority

    if (body.time !== undefined) {
      const parsed = parseTime(body.time)
      if (!parsed) {
        return NextResponse.json({ error: 'Geçersiz saat formatı.' }, { status: 400 })
      }
      updateData.time = parsed
    }

    const updated = await prisma.task.update({
      where: { id },
      data: updateData,
    })

    return NextResponse.json(updated)
  } catch (err) {
    console.error('[tasks PUT] error:', err)
    return NextResponse.json({ error: 'Görev güncellenemedi.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const userId = session.user.id as string

  const existing = await prisma.task.findFirst({ where: { id, userId } })
  if (!existing) {
    return NextResponse.json({ error: 'Görev bulunamadı.' }, { status: 404 })
  }

  await prisma.task.delete({ where: { id } })

  return NextResponse.json({ ok: true })
}
