import { prisma } from './prisma'
import { parseTime } from './utils'
import { generateDailyPlan } from './claude'
import type { ClassifyResult } from '@/types'

export async function executeIntent(
  decision: ClassifyResult,
  userId: string,
  date: string
): Promise<string> {
  const { intent, time, text, new_time } = decision

  switch (intent) {
    case 'add_task': {
      if (!text) return 'Görev metni anlaşılamadı. Lütfen tekrar deneyin.'

      const parsedTime = parseTime(time) || '09:00'

      const task = await prisma.task.create({
        data: {
          userId,
          title: text.trim(),
          time: parsedTime,
          date,
          status: 'pending',
          priority: 'medium',
          source: 'web',
        },
      })

      return `✅ "${task.title}" görevi ${task.time} için eklendi.`
    }

    case 'mark_done': {
      if (!text) return 'Hangi görevi tamamladığınızı anlayamadım.'

      // Find matching task
      const tasks = await prisma.task.findMany({
        where: { userId, date, status: 'pending' },
      })

      const match = findBestMatch(tasks, text, time)
      if (!match) return `"${text}" adında bekleyen bir görev bulunamadı.`

      await prisma.task.update({
        where: { id: match.id },
        data: { status: 'done' },
      })

      return `✅ "${match.title}" görevi tamamlandı olarak işaretlendi.`
    }

    case 'mark_not_done': {
      const tasks = await prisma.task.findMany({
        where: { userId, date },
      })

      const match = text ? findBestMatch(tasks, text, time) : null

      if (match) {
        return `"${match.title}" görevini tamamlayamadınız. Hangi saate taşıyalım?`
      }

      return 'Hangi saate taşıyalım?'
    }

    case 'delete_task': {
      if (!text) return 'Hangi görevi silmek istediğinizi anlayamadım.'

      const tasks = await prisma.task.findMany({
        where: { userId, date },
      })

      const match = findBestMatch(tasks, text, time)
      if (!match) return `"${text}" adında bir görev bulunamadı.`

      await prisma.task.delete({ where: { id: match.id } })

      return `🗑️ "${match.title}" görevi silindi.`
    }

    case 'show_plan': {
      const tasks = await prisma.task.findMany({
        where: { userId, date },
        orderBy: { time: 'asc' },
      })

      if (tasks.length === 0) {
        return 'Bugün için henüz planlanmış görev yok. "Günlük plan oluştur" yazarak yapay zeka destekli plan oluşturabilirsiniz.'
      }

      const done = tasks.filter(t => t.status === 'done').length
      const lines = tasks.map(t => {
        const statusIcon = t.status === 'done' ? '✅' : '⏳'
        return `${statusIcon} ${t.time}: ${t.title}`
      })

      return `📋 Bugünkü Planın (${done}/${tasks.length} tamamlandı):\n\n${lines.join('\n')}`
    }

    case 'daily_plan_request': {
      const existingTasks = await prisma.task.findMany({
        where: { userId, date },
      })

      if (existingTasks.length > 0) {
        // Format existing plan
        const lines = existingTasks
          .sort((a, b) => a.time.localeCompare(b.time))
          .map(t => `⏳ ${t.time}: ${t.title}`)
        return `📋 Bugünün planın zaten hazır (${existingTasks.length} görev):\n\n${lines.join('\n')}\n\nGörevleri Chat üzerinden düzenleyebilirsin.`
      }

      const planItems = await generateDailyPlan(userId, date)

      if (planItems.length === 0) {
        return 'Günlük plan oluşturulamadı. Lütfen ayarlardan Anthropic API anahtarınızı kontrol edin.'
      }

      // Create tasks in DB
      await prisma.task.createMany({
        data: planItems.map(item => ({
          userId,
          title: item.title,
          time: item.time,
          date,
          status: 'pending',
          priority: 'medium',
          source: 'web',
        })),
      })

      const lines = planItems.map(item => `⏳ ${item.time}: ${item.title}`)
      return `📋 Günlük planın oluşturuldu (${planItems.length} görev):\n\n${lines.join('\n')}`
    }

    case 'reschedule': {
      if (!text && !time) return 'Hangi görevi ve hangi saate taşımak istediğinizi anlayamadım.'

      const tasks = await prisma.task.findMany({
        where: { userId, date },
      })

      const match = text ? findBestMatch(tasks, text, time) : null
      if (!match) return 'Taşımak istediğiniz görev bulunamadı.'

      const newParsedTime = parseTime(new_time)
      if (!newParsedTime) return 'Yeni saat formatı anlaşılamadı. Lütfen HH:MM formatında belirtin.'

      await prisma.task.update({
        where: { id: match.id },
        data: { time: newParsedTime },
      })

      return `🕐 "${match.title}" görevi ${newParsedTime}'e taşındı.`
    }

    case 'edit_task': {
      if (!text) return 'Hangi görevi düzenlemek istediğinizi anlayamadım.'

      const tasks = await prisma.task.findMany({
        where: { userId, date },
      })

      const match = findBestMatch(tasks, text, time)
      if (!match) return 'Düzenlemek istediğiniz görev bulunamadı.'

      const newTitle = decision.text?.replace(/^.*?olarak\s+/i, '').trim() || text

      await prisma.task.update({
        where: { id: match.id },
        data: { title: newTitle },
      })

      return `✏️ Görev güncellendi: "${newTitle}"`
    }

    case 'weekly_rule_add': {
      if (!text) return 'Haftalık kural anlaşılamadı.'

      const dayKey = decision.day?.toLowerCase() || 'all'

      await prisma.memory.upsert({
        where: {
          userId_type_key: { userId, type: 'weekly_rule', key: dayKey },
        },
        update: { value: text },
        create: {
          userId,
          type: 'weekly_rule',
          key: dayKey,
          value: text,
        },
      })

      return `📅 Haftalık kural kaydedildi: "${text}" (${decision.day || 'her gün'})`
    }

    case 'ignore': {
      return ''
    }

    case '__error__': {
      return 'Üzgünüm, mesajınızı anlayamadım. Lütfen tekrar deneyin. Örnek: "Saat 10:00\'da toplantı var" veya "Bugünkü planımı göster".'
    }

    default: {
      // Generic conversational response
      return 'Anlıyorum! Görev yönetimi ile ilgili bir şey yapmamı ister misiniz? Görev eklemek, planı görüntülemek veya günlük plan oluşturmak için yazabilirsiniz.'
    }
  }
}

interface TaskLike {
  id: string
  title: string
  time: string
  status: string
}

function findBestMatch(
  tasks: TaskLike[],
  text: string,
  time: string | null | undefined
): TaskLike | null {
  if (tasks.length === 0) return null

  const lowerText = text.toLowerCase()

  // Try exact time match first
  if (time) {
    const byTime = tasks.find(t => t.time === time)
    if (byTime) return byTime
  }

  // Try text similarity
  const byTitle = tasks.find(
    t =>
      t.title.toLowerCase().includes(lowerText) ||
      lowerText.includes(t.title.toLowerCase())
  )
  if (byTitle) return byTitle

  // Partial word match
  const words = lowerText.split(/\s+/).filter(w => w.length > 2)
  for (const task of tasks) {
    const tLower = task.title.toLowerCase()
    if (words.some(w => tLower.includes(w))) return task
  }

  return null
}
