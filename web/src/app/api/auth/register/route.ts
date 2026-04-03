import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'

export async function POST(req: NextRequest) {
  try {
    const { name, email, password } = await req.json()

    if (!email || !password) {
      return NextResponse.json({ error: 'E-posta ve şifre zorunludur.' }, { status: 400 })
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'Şifre en az 6 karakter olmalıdır.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'Bu e-posta adresi zaten kullanımda.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.create({
      data: {
        email,
        name: name || null,
        passwordHash,
      },
    })

    // Create default UserSettings for the user
    await prisma.userSettings.create({
      data: {
        userId: user.id,
        dailyPlanTime: '09:00',
        timezone: 'Europe/Istanbul',
        assistantName: 'Yeliz',
        userName: 'Alp Bey',
        notifyTelegram: true,
        notifyWeb: true,
      },
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('[register] error:', err)
    return NextResponse.json({ error: 'Sunucu hatası. Lütfen tekrar deneyin.' }, { status: 500 })
  }
}
