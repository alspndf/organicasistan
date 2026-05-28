import { google } from 'googleapis'
import { prisma } from './prisma'

function makeOAuth2Client(redirectUri?: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri || process.env.GOOGLE_REDIRECT_URI || ''
  )
}

export function getAuthUrl(redirectUri: string) {
  const client = makeOAuth2Client(redirectUri)
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope: [
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/spreadsheets.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
  })
}

export async function getCalendarEvents(userId: string, date: string, tzOverride?: string) {
  const [token, settings] = await Promise.all([
    prisma.googleCalendarToken.findUnique({ where: { userId } }),
    prisma.userSettings.findUnique({ where: { userId }, select: { timezone: true } }),
  ])
  if (!token) return []

  const tz = tzOverride || settings?.timezone || 'Asia/Ho_Chi_Minh'

  const client = makeOAuth2Client()
  client.setCredentials({
    access_token:  token.accessToken,
    refresh_token: token.refreshToken ?? undefined,
  })

  // Persist refreshed tokens automatically
  client.on('tokens', async (newTokens) => {
    await prisma.googleCalendarToken.update({
      where: { userId },
      data: {
        accessToken: newTokens.access_token ?? token.accessToken,
        ...(newTokens.refresh_token ? { refreshToken: newTokens.refresh_token } : {}),
        ...(newTokens.expiry_date   ? { tokenExpiry: new Date(newTokens.expiry_date) } : {}),
      },
    }).catch(() => {})
  })

  const calendar = google.calendar({ version: 'v3', auth: client })

  // Build midnight-to-midnight range in user's timezone
  const dayStart = new Date(`${date}T00:00:00`).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T')
  const dayEnd   = new Date(`${date}T23:59:59`).toLocaleString('sv-SE', { timeZone: tz }).replace(' ', 'T')

  // Get the UTC offset for the timezone on this date
  const offsetMs  = new Date(`${date}T12:00:00`).getTime()
               - new Date(new Date(`${date}T12:00:00`).toLocaleString('en-US', { timeZone: tz })).getTime()
  const sign      = offsetMs >= 0 ? '+' : '-'
  const offsetAbs = Math.abs(offsetMs)
  const offsetHH  = String(Math.floor(offsetAbs / 3600000)).padStart(2, '0')
  const offsetMM  = String(Math.floor((offsetAbs % 3600000) / 60000)).padStart(2, '0')
  const tzOffset  = `${sign}${offsetHH}:${offsetMM}`

  const timeMin = `${date}T00:00:00${tzOffset}`
  const timeMax = `${date}T23:59:59${tzOffset}`

  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy:     'startTime',
    maxResults:  20,
  })

  return (res.data.items || []).map(e => ({
    id:        e.id,
    title:     e.summary || '(başlıksız)',
    start:     e.start?.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
      : 'Tüm gün',
    end:       e.end?.dateTime
      ? new Date(e.end.dateTime).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: tz })
      : '',
    location:  e.location || null,
    allDay:    !e.start?.dateTime,
    attendees: (e.attendees || [])
      .filter(a => !a.self)
      .map(a => a.displayName || a.email || '')
      .filter(Boolean),
  }))
}
