import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const redirectUri = `${base}/api/calendar/auth/callback`

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  )

  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })

  return NextResponse.redirect(url)
}
