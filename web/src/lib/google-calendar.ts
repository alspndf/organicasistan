import { google } from 'googleapis'
import { prisma } from './prisma'

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/calendar/auth/callback`
  )
}

export function getAuthUrl() {
  const client = getOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })
}

export async function getCalendarEvents(userId: string, date: string) {
  const token = await prisma.googleCalendarToken.findUnique({ where: { userId } })
  if (!token) return []

  const client = getOAuth2Client()
  client.setCredentials({
    access_token:  token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
  })

  // Auto-refresh token if expired
  client.on('tokens', async (newTokens) => {
    await prisma.googleCalendarToken.update({
      where: { userId },
      data: {
        accessToken: newTokens.access_token ?? token.accessToken,
        ...(newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}),
        ...(newTokens.expiry_date   ? { tokenExpiry: new Date(newTokens.expiry_date) } : {}),
      },
    })
  })

  const calendar = google.calendar({ version: 'v3', auth: client })

  const dayStart = new Date(`${date}T00:00:00+03:00`).toISOString()
  const dayEnd   = new Date(`${date}T23:59:59+03:00`).toISOString()

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: dayStart,
    timeMax: dayEnd,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  })

  return (res.data.items || []).map(e => ({
    id:       e.id,
    title:    e.summary || '(başlıksız)',
    start:    e.start?.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
      : 'Tüm gün',
    end:      e.end?.dateTime
      ? new Date(e.end.dateTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
      : '',
    location: e.location || null,
    allDay:   !e.start?.dateTime,
  }))
}
