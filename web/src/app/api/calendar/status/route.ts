import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ connected: false })

  const token = await prisma.googleCalendarToken.findUnique({
    where: { userId: session.user.id },
    select: { email: true },
  })

  return NextResponse.json({ connected: !!token, email: token?.email ?? null })
}
