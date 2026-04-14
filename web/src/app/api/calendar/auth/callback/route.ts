import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { google } from 'googleapis'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.url))

  const code = req.nextUrl.searchParams.get('code')
  if (!code) return NextResponse.redirect(new URL('/settings?calendar=error', req.url))

  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`
  const redirectUri = `${base}/api/calendar/auth/callback`

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  )

  const { tokens } = await client.getToken(code)
  client.setCredentials(tokens)

  const oauth2 = google.oauth2({ version: 'v2', auth: client })
  const googleEmail = await oauth2.userinfo.get()
    .then(r => r.data.email ?? null)
    .catch(() => null)

  await prisma.googleCalendarToken.upsert({
    where:  { userId: session.user.id },
    create: {
      userId:       session.user.id,
      accessToken:  tokens.access_token!,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email:        googleEmail,
    },
    update: {
      accessToken:  tokens.access_token!,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiry:  tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      email:        googleEmail,
    },
  })

  return NextResponse.redirect(new URL('/settings?calendar=connected', req.url))
}
