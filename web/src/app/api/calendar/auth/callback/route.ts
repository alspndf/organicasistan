import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { google } from 'googleapis'
import { getBaseUrl } from '@/lib/get-base-url'

export async function GET(req: NextRequest) {
  const base  = getBaseUrl(req)
  const error = req.nextUrl.searchParams.get('error')
  const code  = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')

  if (error || !code || !state) {
    return NextResponse.redirect(`${base}/settings?calendar=error&reason=${error || 'missing_params'}`)
  }

  try {
    // Decode userId from state — no session cookie needed
    const { userId, base: stateBase } = JSON.parse(Buffer.from(state, 'base64').toString())
    const redirectBase = stateBase || base

    if (!userId) {
      return NextResponse.redirect(`${redirectBase}/settings?calendar=error&reason=no_user_in_state`)
    }

    const redirectUri = `${redirectBase}/api/calendar/auth/callback`

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
      where:  { userId },
      create: {
        userId,
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

    return NextResponse.redirect(`${redirectBase}/settings?calendar=connected`)

  } catch (e: unknown) {
    const msg = encodeURIComponent(e instanceof Error ? e.message : 'unknown_error')
    console.error('[Calendar OAuth] callback error:', e)
    return NextResponse.redirect(`${base}/settings?calendar=error&reason=${msg}`)
  }
}
