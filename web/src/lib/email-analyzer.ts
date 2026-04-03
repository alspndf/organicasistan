import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { decrypt } from './encryption'
import { today } from './utils'
import type { EmailActionItem } from '@/types'
import type { EmailData } from './gmail'

const ANALYZER_SYSTEM = `Sen bir e-posta analistissin. Verilen e-postaları analiz ederek aksiyon öğelerini çıkar.

Yanıtını aşağıdaki JSON formatında ver:
{
  "summary": "E-postaların kısa özeti (1-3 cümle)",
  "actionItems": [
    {
      "type": "meeting|action|deadline|info",
      "title": "Aksiyon başlığı",
      "time": "HH:MM veya null",
      "priority": "high|medium|low",
      "from": "gönderen adı veya email",
      "rawSubject": "orijinal konu"
    }
  ]
}

Tipler:
- meeting: Toplantı, görüşme, çağrı
- action: Yapılacak iş, yanıtlanacak e-posta
- deadline: Son tarih, teslim
- info: Önemli bilgi, güncelleme

Sadece JSON döndür, başka metin ekleme.`

async function getAnthropicClient(userId: string): Promise<Anthropic> {
  let apiKey = process.env.ANTHROPIC_API_KEY || ''

  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId },
      select: { anthropicKeyEnc: true },
    })
    if (settings?.anthropicKeyEnc) {
      apiKey = decrypt(settings.anthropicKeyEnc)
    }
  } catch {
    // fallback to env
  }

  return new Anthropic({ apiKey })
}

export async function analyzeEmails(
  emails: EmailData[],
  userId: string
): Promise<{ actionItems: EmailActionItem[]; summary: string }> {
  if (emails.length === 0) {
    return { actionItems: [], summary: 'Analiz edilecek e-posta bulunamadı.' }
  }

  const emailsText = emails
    .slice(0, 10) // limit to 10 most recent
    .map(
      (e, i) =>
        `E-posta ${i + 1}:\nKimden: ${e.from}\nKonu: ${e.subject}\nTarih: ${e.date}\n---\n${e.body}`
    )
    .join('\n\n===\n\n')

  const client = await getAnthropicClient(userId)

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: ANALYZER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Aşağıdaki ${emails.length} e-postayı analiz et:\n\n${emailsText}`,
        },
      ],
    })

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    const jsonMatch = rawText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON in response')

    const parsed = JSON.parse(jsonMatch[0]) as {
      summary: string
      actionItems: EmailActionItem[]
    }

    // Auto-create tasks for meeting-type items
    const todayDate = today()
    const meetingItems = parsed.actionItems.filter(item => item.type === 'meeting' && item.time)

    if (meetingItems.length > 0) {
      try {
        for (const item of meetingItems) {
          await prisma.task.create({
            data: {
              userId,
              title: item.title,
              time: item.time || '09:00',
              date: todayDate,
              status: 'pending',
              priority: item.priority || 'medium',
              source: 'email',
            },
          })
        }
      } catch {
        // ignore task creation errors
      }
    }

    return {
      actionItems: parsed.actionItems || [],
      summary: parsed.summary || '',
    }
  } catch (err) {
    console.error('[analyzeEmails] error:', err)
    return {
      actionItems: [],
      summary: 'E-postalar analiz edilirken bir hata oluştu.',
    }
  }
}
