export interface Task {
  id: string
  userId: string
  title: string
  time: string
  date: string
  status: 'pending' | 'done' | 'skipped'
  priority: 'high' | 'medium' | 'low'
  source: 'web' | 'telegram' | 'email'
  createdAt: string
  updatedAt: string
}

export interface WeeklyScheduleDay {
  dayKey: string
  activities: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface ClassifyResult {
  intent: string
  time: string | null
  text: string | null
  new_time: string | null
  day: string | null
}

export interface EmailActionItem {
  type: 'meeting' | 'action' | 'deadline' | 'info'
  title: string
  time?: string
  priority: 'high' | 'medium' | 'low'
  from?: string
  rawSubject?: string
}

export interface UserSettings {
  anthropicKeySet: boolean
  telegramTokenSet: boolean
  telegramChatId: string | null
  notifyTelegram: boolean
  notifyWeb: boolean
  dailyPlanTime: string
  timezone: string
  assistantName: string
  userName: string
}
