import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getRecentEmails } from '@/lib/gmail'
import { analyzeEmails } from '@/lib/email-analyzer'
import { prisma } from '@/lib/prisma'

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  // Check connection
  const connection = await prisma.emailConnection.findUnique({ where: { userId } })
  if (!connection) {
    return NextResponse.json({ error: 'E-posta hesabı bağlı değil.' }, { status: 400 })
  }

  try {
    const emails = await getRecentEmails(userId, 20)
    const result = await analyzeEmails(emails, userId)

    // Update last checked time
    await prisma.emailConnection.update({
      where: { userId },
      data: { lastChecked: new Date() },
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[email/fetch] error:', err)
    return NextResponse.json({ error: 'E-postalar alınamadı.' }, { status: 500 })
  }
}
