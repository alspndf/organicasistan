import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  let settings = await prisma.userSettings.findUnique({ where: { userId } })

  if (!settings) {
    settings = await prisma.userSettings.create({
      data: {
        userId,
        dailyPlanTime: '09:00',
        timezone: 'Europe/Istanbul',
        assistantName: 'Yeliz',
        userName: 'Alp Bey',
        notifyTelegram: true,
        notifyWeb: true,
      },
    })
  }

  // Mask sensitive fields
  return NextResponse.json({
    anthropicKeySet: !!settings.anthropicKeyEnc,
    telegramTokenSet: !!settings.telegramToken,
    telegramChatId: settings.telegramChatId || null,
    notifyTelegram: settings.notifyTelegram,
    notifyWeb: settings.notifyWeb,
    dailyPlanTime: settings.dailyPlanTime,
    timezone: settings.timezone,
    assistantName: settings.assistantName,
    userName: settings.userName,
  })
}

export async function PUT(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  try {
    const body = await req.json()

    const updateData: Record<string, unknown> = {}

    if (body.anthropicKey) {
      updateData.anthropicKeyEnc = encrypt(body.anthropicKey)
    }

    if (body.telegramToken) {
      updateData.telegramToken = body.telegramToken
    }

    if (body.telegramChatId !== undefined) {
      updateData.telegramChatId = body.telegramChatId || null
    }

    if (body.notifyTelegram !== undefined) {
      updateData.notifyTelegram = Boolean(body.notifyTelegram)
    }

    if (body.notifyWeb !== undefined) {
      updateData.notifyWeb = Boolean(body.notifyWeb)
    }

    if (body.dailyPlanTime) {
      updateData.dailyPlanTime = body.dailyPlanTime
    }

    if (body.timezone) {
      updateData.timezone = body.timezone
    }

    if (body.assistantName) {
      updateData.assistantName = body.assistantName
    }

    if (body.userName) {
      updateData.userName = body.userName
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...updateData,
        dailyPlanTime: (updateData.dailyPlanTime as string) || '09:00',
        timezone: (updateData.timezone as string) || 'Europe/Istanbul',
        assistantName: (updateData.assistantName as string) || 'Yeliz',
        userName: (updateData.userName as string) || 'Alp Bey',
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[settings PUT] error:', err)
    return NextResponse.json({ error: 'Ayarlar kaydedilemedi.' }, { status: 500 })
  }
}
