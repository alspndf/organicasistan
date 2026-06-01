/**
 * Cron runner — run this alongside `next start` for scheduled jobs.
 * Usage: node cron-runner.mjs
 *
 * Requires: npm install node-cron (already in web/node_modules)
 */

import cron from 'node-cron'

const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000'
const SECRET = process.env.CRON_SECRET || ''
const HEADERS = { 'Content-Type': 'application/json', 'x-cron-secret': SECRET }

const call = (path) =>
  fetch(`${BASE_URL}${path}`, { method: 'POST', headers: HEADERS })
    .then((r) => r.json())
    .then((d) => console.log(`[CRON] ${path}`, d))
    .catch((e) => console.error(`[CRON] ${path} error:`, e.message))

// 09:00 — daily plan summary via Telegram
cron.schedule('0 9 * * *', () => call('/api/cron/daily-plan'), { timezone: 'Europe/Istanbul' })

// Every minute — fire pending reminders
cron.schedule('* * * * *', () => call('/api/cron/reminders'))

// Every hour — email check for configured users
cron.schedule('0 * * * *', () => call('/api/cron/email-check'))

console.log('[CRON] Runner started. Jobs: daily-plan(09:00 Istanbul), reminders(1min), email-check(hourly)')
