import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { exchangeCode } from '@/lib/gmail'
import { prisma } from '@/lib/prisma'
import { encrypt } from '@/lib/encryption'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  const userId = session.user.id as string
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/email?error=no_code', req.url))
  }

  try {
    const tokens = await exchangeCode(code)

    const encAccessToken = tokens.access_token ? encrypt(tokens.access_token) : null
    const encRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : null
    const tokenExpiry = tokens.expiry_date ? new Date(tokens.expiry_date) : null

    await prisma.emailConnection.upsert({
      where: { userId },
      update: {
        provider: 'gmail',
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
      },
      create: {
        userId,
        provider: 'gmail',
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
      },
    })

    return NextResponse.redirect(new URL('/email?connected=1', req.url))
  } catch (err) {
    console.error('[email/callback] error:', err)
    return NextResponse.redirect(new URL('/email?error=exchange_failed', req.url))
  }
}
