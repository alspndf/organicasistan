import { NextRequest } from 'next/server'

export function getBaseUrl(req: NextRequest): string {
  // Explicit override always wins
  if (process.env.GOOGLE_REDIRECT_URI) {
    const url = new URL(process.env.GOOGLE_REDIRECT_URI)
    return `${url.protocol}//${url.host}`
  }
  // Railway / reverse-proxy sets x-forwarded headers
  const proto = req.headers.get('x-forwarded-proto') || req.nextUrl.protocol.replace(':', '')
  const host  = req.headers.get('x-forwarded-host')  || req.headers.get('host') || req.nextUrl.host
  return `${proto}://${host}`
}
