import { NextRequest, NextResponse } from 'next/server'

export interface WAStatus {
  connected: boolean
  phone: string
  qrPending: boolean
  qrCode?: string   // base64 PNG — present while qrPending, cleared on connect
  updatedAt: string
}

// In-memory store — persists across hot-reloads (same pattern as bot-manager)
declare global {
  // eslint-disable-next-line no-var
  var __waStatuses: Map<string, WAStatus> | undefined
}

function getWAStatuses() {
  if (!global.__waStatuses) global.__waStatuses = new Map()
  return global.__waStatuses
}

// POST /api/bot/wa-notify — called by the bot process to report WA status
export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-bot-secret')
  if (secret !== (process.env.BOT_SECRET || 'organic-bot-internal')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = req.headers.get('x-bot-user-id') || 'default'

  let body: Partial<WAStatus>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const prev = getWAStatuses().get(userId)

  getWAStatuses().set(userId, {
    connected:  body.connected  ?? false,
    phone:      body.phone      ?? '',
    qrPending:  body.qrPending  ?? false,
    // Keep qrCode while pending; clear it once connected or explicitly absent
    qrCode:     body.connected ? undefined : (body.qrCode ?? prev?.qrCode),
    updatedAt:  new Date().toISOString(),
  })

  return NextResponse.json({ ok: true })
}
