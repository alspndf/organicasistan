import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getBaseUrl } from '@/lib/get-base-url'
import { getAuthUrl } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const base        = getBaseUrl(req)
    const redirectUri = `${base}/api/email/auth/callback`
    // Encode userId, base, and redirectUri in state so callback works behind Railway proxy
    const state = Buffer.from(JSON.stringify({ userId: session.user.id, base, redirectUri })).toString('base64')
    const url = getAuthUrl(redirectUri, state)
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[email/auth] error:', err)
    return NextResponse.json({ error: 'OAuth URL oluşturulamadı.' }, { status: 500 })
  }
}
