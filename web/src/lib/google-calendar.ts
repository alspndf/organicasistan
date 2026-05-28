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

  // Build midnight-to-midnight range expressed as UTC ISO strings
  // Use Intl to extract the tz offset reliably — avoids the sign bug from manual offset math
  const [y, m, d] = date.split('-').map(Number)
  const probe = new Date(`${date}T12:00:00Z`) // noon UTC avoids DST edge cases
  const offsetStr = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00'
  // offsetStr = e.g. "GMT+07:00" for Asia/Ho_Chi_Minh
  const om = offsetStr.match(/GMT([+-])(\d{2}):(\d{2})/)
  const tzOffsetMs = om
    ? (om[1] === '+' ? 1 : -1) * (parseInt(om[2]) * 60 + parseInt(om[3])) * 60000
    : 0

  // Subtract tz offset: UTC+7 → subtract 7h → Ho Chi Minh midnight = 17:00 UTC prev day
  const timeMin = new Date(Date.UTC(y, m - 1, d,  0,  0,  0,   0) - tzOffsetMs).toISOString()
  const timeMax = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999) - tzOffsetMs).toISOString()

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
