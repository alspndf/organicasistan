import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { classifyMessage } from '@/lib/claude'
import { executeIntent } from '@/lib/task-engine'
import { today } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id as string

  try {
    const { message } = await req.json()

    if (!message || !message.trim()) {
      return NextResponse.json({ error: 'Mesaj boş olamaz.' }, { status: 400 })
    }

    const dateStr = today()

    const decision = await classifyMessage(message.trim(), userId, dateStr)
    const response = await executeIntent(decision, userId, dateStr)

    return NextResponse.json({ response })
  } catch (err) {
    console.error('[chat] error:', err)
    return NextResponse.json({ error: 'Bir hata oluştu.' }, { status: 500 })
  }
}
