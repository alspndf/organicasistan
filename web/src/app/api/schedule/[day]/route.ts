import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

interface Params {
  params: Promise<{ day: string }>
}

export async function PUT(req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string
  const { day } = await params

  const validDays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  if (!validDays.includes(day)) {
    return NextResponse.json({ error: 'Geçersiz gün.' }, { status: 400 })
  }

  try {
    const { activities } = await req.json()

    if (!Array.isArray(activities)) {
      return NextResponse.json({ error: 'activities bir dizi olmalıdır.' }, { status: 400 })
    }

    const row = await prisma.weeklySchedule.upsert({
      where: { userId_dayKey: { userId, dayKey: day } },
      update: { activities: JSON.stringify(activities) },
      create: { userId, dayKey: day, activities: JSON.stringify(activities) },
    })

    return NextResponse.json({ ok: true, dayKey: row.dayKey, activities })
  } catch (err) {
    console.error('[schedule PUT] error:', err)
    return NextResponse.json({ error: 'Kayıt sırasında hata oluştu.' }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string
  const { day } = await params

  try {
    await prisma.weeklySchedule.deleteMany({
      where: { userId, dayKey: day },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[schedule DELETE] error:', err)
    return NextResponse.json({ error: 'Silme sırasında hata oluştu.' }, { status: 500 })
  }
}
