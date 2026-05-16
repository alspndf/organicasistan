import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import type { WAStatus } from '../wa-notify/route'

// GET /api/bot/whatsapp-status — returns current WA connection status for the user
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const status = (global as unknown as { __waStatuses?: Map<string, WAStatus> })
    .__waStatuses?.get(session.user.id as string)
    ?? { connected: false, phone: '', qrPending: false }

  return NextResponse.json(status)
}
