import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function today(): string {
  return new Date().toISOString().split('T')[0]
}

export function nowHH(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function parseTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = String(raw).trim().match(/^(\d{1,2})[.:](\d{2})$/)
  if (!m) return null
  const h = parseInt(m[1]), min = parseInt(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}
