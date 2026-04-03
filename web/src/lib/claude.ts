import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { decrypt } from './encryption'
import type { ClassifyResult } from '@/types'

const CLASSIFIER_SYSTEM = `Sen Yeliz adlı bir AI kişisel asistanın görev sınıflandırıcısısın.

Kullanıcının mesajını analiz et ve aşağıdaki JSON formatında yanıt ver:

{
  "intent": "<intent>",
  "time": "<HH:MM veya null>",
  "text": "<görev metni veya null>",
  "new_time": "<yeni saat HH:MM veya null>",
  "day": "<gün adı veya null>",
  "date": "<YYYY-MM-DD veya null>"
}

Geçerli intent'ler:
- add_task: Yeni görev ekleme ("saat 14:00'de toplantı var", "10:30'da spor yap", "yarın 15:00'de toplantı", "3 gün sonra randevu")
- mark_done: Görevi tamamlandı olarak işaretle ("toplantıyı hallettim", "sporu yaptım")
- mark_not_done: Görevi yapamadım, ertele ("sporu yapamadım", "toplantıya giremedim")
- delete_task: Görevi sil ("toplantıyı iptal et", "sporu sil")
- show_plan: Bugünkü planı göster ("planım ne", "bugün ne var", "listemi göster")
- daily_plan_request: Günlük plan oluştur ("bugün için plan yap", "günlük planımı oluştur")
- reschedule: Görevi yeni saate taşı ("toplantıyı 15:00'e al", "sporu 18:00'e taşı")
- edit_task: Görev metnini düzenle ("toplantıyı 'proje toplantısı' olarak güncelle")
- weekly_rule_add: Haftalık tekrar eden kural ekle ("her pazartesi spor")
- routine_add: Günlük rutin/alışkanlık ekle ("her gün sabah 7'de günlük planı gönder", "her sabah bana özet yaz", "hergün yapılacaklar listeme ekle")
- ignore: Görevle ilgisi yok, sohbet ("nasılsın", "teşekkürler")

Tarih kuralları (date alanı için):
- Bugün → null
- Yarın → bugünün tarihi + 1 gün (YYYY-MM-DD)
- "X gün sonra" → bugün + X gün
- "Cuma", "Pazartesi" gibi gün adları → o güne karşılık gelen tarih (geçmişe gitme, ileri bak)
- Geçmiş tarih veya bugün → null

Önemli kurallar:
- Sadece JSON döndür, başka metin ekleme
- Saat formatı mutlaka HH:MM olsun (24 saat)
- Eğer saat belirsizse null yaz
- Türkçe metinleri olduğu gibi koru`

const PLANNER_SYSTEM = `Sen Yeliz adlı bir AI kişisel asistan olarak günlük plan oluşturuyorsun.

Kullanıcının haftalık programını ve bugünün tarihini dikkate alarak mantıklı bir günlük plan oluştur.

Kurallar:
- Her görev için mantıklı bir saat belirle
- Görevleri 09:00 - 22:00 arasına dağıt
- Öncelikli görevleri sabah saatlerine koy
- Mola ve öğle yemeği saatlerini unutma
- Cevabı şu formatta ver:

PLAN:
- HH:MM: görev adı
- HH:MM: görev adı
...`

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
    // fallback to env key
  }

  return new Anthropic({ apiKey })
}

export async function classifyMessage(
  message: string,
  userId: string,
  date: string
): Promise<ClassifyResult> {
  // Load today's tasks for context
  let tasksContext = ''
  try {
    const tasks = await prisma.task.findMany({
      where: { userId, date },
      orderBy: { time: 'asc' },
      select: { time: true, title: true, status: true },
    })

    if (tasks.length > 0) {
      tasksContext = '\n\nBugünkü görevler:\n' + tasks
        .map(t => `- ${t.time}: ${t.title} [${t.status}]`)
        .join('\n')
    }
  } catch {
    // ignore
  }

  const client = await getAnthropicClient(userId)

  let lastErr: unknown

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 256,
        system: CLASSIFIER_SYSTEM + `\n\nBugünün tarihi: ${date}` + tasksContext,
        messages: [{ role: 'user', content: message }],
      })

      const rawText = response.content
        .filter(b => b.type === 'text')
        .map(b => (b as { type: 'text'; text: string }).text)
        .join('')
        .trim()

      // Extract JSON from response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('No JSON in response')

      const parsed = JSON.parse(jsonMatch[0]) as ClassifyResult
      return parsed
    } catch (err) {
      lastErr = err
      if (attempt < 1) await new Promise(r => setTimeout(r, 500))
    }
  }

  console.error('[classifyMessage] failed after 2 attempts:', lastErr)
  return { intent: '__error__', time: null, text: null, new_time: null, day: null }
}

export async function generateDailyPlan(
  userId: string,
  date: string
): Promise<Array<{ time: string; title: string }>> {
  // Get weekly schedule for context
  const now = new Date(date + 'T12:00:00')
  const dayIndex = now.getDay()
  const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][dayIndex]

  let scheduleContext = ''
  try {
    const schedule = await prisma.weeklySchedule.findUnique({
      where: { userId_dayKey: { userId, dayKey } },
    })
    if (schedule) {
      const activities = JSON.parse(schedule.activities) as string[]
      if (activities.length > 0) {
        scheduleContext = '\n\nBu gün için haftalık program:\n' + activities.map(a => `- ${a}`).join('\n')
      }
    }
  } catch {
    // ignore
  }

  // Get existing tasks
  const tasks = await prisma.task.findMany({
    where: { userId, date },
    orderBy: { time: 'asc' },
    select: { time: true, title: true },
  })

  let existingContext = ''
  if (tasks.length > 0) {
    existingContext = '\n\nMevcut görevler:\n' + tasks.map(t => `- ${t.time}: ${t.title}`).join('\n')
  }

  const client = await getAnthropicClient(userId)

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 512,
      system: PLANNER_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Tarih: ${date}${scheduleContext}${existingContext}\n\nBugün için kapsamlı bir günlük plan oluştur.`,
        },
      ],
    })

    const rawText = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    // Parse plan lines: "- HH:MM: task"
    const lines = rawText.split('\n')
    const result: Array<{ time: string; title: string }> = []

    for (const line of lines) {
      const m = line.match(/[-•]\s*(\d{1,2}:\d{2})\s*[:\-]\s*(.+)/)
      if (m) {
        const timeStr = m[1].padStart(5, '0')
        result.push({ time: timeStr, title: m[2].trim() })
      }
    }

    return result
  } catch (err) {
    console.error('[generateDailyPlan] error:', err)
    return []
  }
}
