'use server'
import { NextRequest, NextResponse } from 'next/server'
import { google } from 'googleapis'
import { prisma } from '@/lib/prisma'

const SHEETS_ID = process.env.SHEETS_ID || '1DW3bbhhbBrC6VSohdskedhb_iVDI-VJO_FOjB1nRAkc'

function isBotAuthorized(req: NextRequest) {
  return req.headers.get('x-bot-secret') === (process.env.BOT_SECRET || 'organic-bot-internal')
}

export async function POST(req: NextRequest) {
  if (!isBotAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = req.headers.get('x-bot-user-id')
  if (!userId) return NextResponse.json({ context: 'YOK' })

  const { names } = await req.json() as { names: string[] }
  if (!names || !names.length) return NextResponse.json({ context: 'YOK' })

  const token = await prisma.googleCalendarToken.findUnique({ where: { userId } })
  if (!token) return NextResponse.json({ context: 'YOK' })

  try {
    const auth = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    )
    auth.setCredentials({
      access_token:  token.accessToken,
      refresh_token: token.refreshToken ?? undefined,
    })
    auth.on('tokens', async (newTokens) => {
      await prisma.googleCalendarToken.update({
        where: { userId },
        data: {
          accessToken: newTokens.access_token ?? token.accessToken,
          ...(newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}),
          ...(newTokens.expiry_date   ? { tokenExpiry: new Date(newTokens.expiry_date) } : {}),
        },
      }).catch(() => {})
    })

    const sheets = google.sheets({ version: 'v4', auth })
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_ID,
      range: 'KİŞİLER!A:H',
    })

    const rows = res.data.values || []
    const dataRows = rows[0]?.[0]?.toLowerCase() === 'ad' ? rows.slice(1) : rows

    const matches: string[] = []
    for (const name of names) {
      const nameLower = name.toLowerCase().trim()
      const row = dataRows.find(r => r[0] && r[0].toLowerCase().trim() === nameLower)
      if (!row) continue
      const [ad, , sonGorusme, anaKonu, bekleyenAksiyonlar, , sonrakiAdim] = row
      matches.push(
        `${ad}\nSon görüşme: ${sonGorusme || '-'}\nKonu: ${anaKonu || '-'}\nBekleyen: ${bekleyenAksiyonlar || '-'}\nSonraki adım: ${sonrakiAdim || '-'}`
      )
    }

    return NextResponse.json({ context: matches.length ? matches.join('\n\n---\n\n') : 'YOK' })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[sheets/person-context]', msg)
    return NextResponse.json({ context: 'YOK' })
  }
}
