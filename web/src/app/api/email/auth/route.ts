import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getAuthUrl } from '@/lib/gmail'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const url = getAuthUrl()
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[email/auth] error:', err)
    return NextResponse.json({ error: 'OAuth URL oluşturulamadı.' }, { status: 500 })
  }
}
