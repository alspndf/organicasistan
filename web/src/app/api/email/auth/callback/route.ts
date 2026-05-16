import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/gmail'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Decode userId, base, and redirectUri from state param (set in /api/email/auth)
  let userId: string
  let base: string
  let redirectUri: string
  try {
    if (!state) throw new Error('state missing')
    const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'))
    userId      = decoded.userId
    base        = decoded.base || new URL(req.url).origin
    redirectUri = decoded.redirectUri || `${base}/api/email/auth/callback`
    if (!userId) throw new Error('userId missing')
  } catch {
    console.error('[email/callback] invalid state param:', state)
    return NextResponse.redirect(new URL('/settings?gmail=error&reason=invalid_state', req.url))
  }

  if (error) {
    console.error('[email/callback] OAuth error from Google:', error)
    return NextResponse.redirect(`${base}/settings?gmail=error&reason=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${base}/settings?gmail=error&reason=no_code`)
  }

  try {
    const tokens = await exchangeCode(code, redirectUri)

    if (!tokens.refresh_token) {
      console.warn('[email/callback] no refresh_token returned — user may need to revoke and re-auth')
    }

    const encAccessToken  = tokens.access_token  ? encrypt(tokens.access_token)  : null
    const encRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null
    const tokenExpiry     = tokens.expiry_date   ? new Date(tokens.expiry_date)  : null

    await prisma.emailConnection.upsert({
      where: { userId },
      update:  { provider: 'gmail', accessToken: encAccessToken, refreshToken: encRefreshToken, tokenExpiry },
      create:  { userId, provider: 'gmail', accessToken: encAccessToken, refreshToken: encRefreshToken, tokenExpiry },
    })

    console.log(`[email/callback] Gmail connected for userId=${userId}`)
    return NextResponse.redirect(`${base}/settings?gmail=connected`)
  } catch (err) {
    console.error('[email/callback] error:', err)
    const reason = err instanceof Error ? err.message : 'exchange_failed'
    return NextResponse.redirect(`${base}/settings?gmail=error&reason=${encodeURIComponent(reason)}`)
  }
}
