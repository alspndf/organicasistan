import { google } from 'googleapis'
import { prisma } from './prisma'
import { decrypt, encrypt } from './encryption'

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

export class GmailAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailAuthError'
  }
}

function createOAuth2Client(redirectUri: string) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  )
}

export function getAuthUrl(redirectUri: string, state?: string): string {
  const client = createOAuth2Client(redirectUri)
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    ...(state ? { state } : {}),
  })
}

export async function exchangeCode(code: string, redirectUri: string) {
  const client = createOAuth2Client(redirectUri)
  const { tokens } = await client.getToken(code)
  return tokens
}

export interface EmailData {
  id: string
  from: string
  subject: string
  body: string
  date: string
}

export async function getRecentEmails(userId: string, maxResults = 20): Promise<EmailData[]> {
  const connection = await prisma.emailConnection.findUnique({ where: { userId } })
  if (!connection || !connection.accessToken) {
    throw new GmailAuthError('Gmail hesabı bağlı değil.')
  }

  const client = createOAuth2Client(
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/email/auth/callback`
  )

  let accessToken: string
  let refreshToken: string | undefined
  try {
    accessToken = decrypt(connection.accessToken)
    refreshToken = connection.refreshToken ? decrypt(connection.refreshToken) : undefined
  } catch (e) {
    console.error('[gmail] token decrypt error:', e)
    throw new GmailAuthError('Gmail token şifresi çözülemedi, yeniden bağlanın.')
  }

  if (!refreshToken) {
    throw new GmailAuthError('Gmail refresh token yok, yeniden bağlanın.')
  }

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: connection.tokenExpiry?.getTime(),
  })

  // Auto-refresh: persist new tokens to DB
  client.on('tokens', async tokens => {
    if (tokens.access_token) {
      await prisma.emailConnection.update({
        where: { userId },
        data: {
          accessToken: encrypt(tokens.access_token),
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      }).catch(err => console.error('[gmail] token refresh save error:', err))
    }
  })

  const gmail = google.gmail({ version: 'v1', auth: client })

  let listRes
  try {
    listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults,
      q: 'in:inbox -category:promotions -category:social',
    })
  } catch (e: unknown) {
    const status = (e as { status?: number; code?: number })?.status ?? (e as { status?: number; code?: number })?.code
    console.error('[gmail] messages.list error (status=%d):', status, e)
    if (status === 401 || status === 403) {
      throw new GmailAuthError('Gmail yetkilendirmesi süresi doldu, yeniden bağlanın.')
    }
    throw new Error(`Gmail API hatası: ${e instanceof Error ? e.message : String(e)}`)
  }

  const messages = listRes.data.messages || []
  const emails: EmailData[] = []

  for (const msg of messages) {
    if (!msg.id) continue
    try {
      const msgRes = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      })

      const payload = msgRes.data.payload
      const headers = payload?.headers || []

      const from = headers.find(h => h.name?.toLowerCase() === 'from')?.value || ''
      const subject = headers.find(h => h.name?.toLowerCase() === 'subject')?.value || '(Konu yok)'
      const date = headers.find(h => h.name?.toLowerCase() === 'date')?.value || ''

      let body = ''
      if (payload?.parts) {
        for (const part of payload.parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8')
            break
          }
        }
      } else if (payload?.body?.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8')
      }

      if (body.length > 1000) body = body.slice(0, 1000) + '...'

      emails.push({ id: msg.id, from, subject, body: body.trim(), date })
    } catch {
      // skip individual message errors silently
    }
  }

  return emails
}
