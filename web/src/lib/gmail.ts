import { google } from 'googleapis'
import { prisma } from './prisma'
import { decrypt, encrypt } from './encryption'

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || `${process.env.NEXTAUTH_URL}/api/email/auth/callback`
  )
}

export function getAuthUrl(): string {
  const client = createOAuth2Client()
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  })
}

export async function exchangeCode(code: string) {
  const client = createOAuth2Client()
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
    throw new Error('E-posta bağlantısı bulunamadı.')
  }

  const client = createOAuth2Client()

  const accessToken = decrypt(connection.accessToken)
  const refreshToken = connection.refreshToken ? decrypt(connection.refreshToken) : undefined

  client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: connection.tokenExpiry?.getTime(),
  })

  // Auto-refresh listener
  client.on('tokens', async tokens => {
    if (tokens.access_token) {
      const encNew = encrypt(tokens.access_token)
      await prisma.emailConnection.update({
        where: { userId },
        data: {
          accessToken: encNew,
          tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        },
      })
    }
  })

  const gmail = google.gmail({ version: 'v1', auth: client })

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: 'in:inbox -category:promotions -category:social',
  })

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

      // Extract body text
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

      // Truncate long bodies
      if (body.length > 1000) body = body.slice(0, 1000) + '...'

      emails.push({ id: msg.id, from, subject, body: body.trim(), date })
    } catch {
      // skip individual message errors
    }
  }

  return emails
}
