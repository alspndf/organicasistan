/**
 * Organic Assistant — Claude Tool-Use Agent
 * Claude = Agent with tools, conversation memory, proactive behavior.
 *
 * Flow:
 *   User message → conversationHistory → Claude tool-use loop → response
 *
 * Tools: add_task | edit_task | delete_tasks | mark_done |
 *        reschedule_task | create_daily_plan | get_plan |
 *        save_memory | analyze_emails
 */

'use strict';

require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const cron        = require('node-cron');
const Anthropic   = require('@anthropic-ai/sdk');
const fs          = require('fs');
const path        = require('path');
const https       = require('https');

// ─── Config ───────────────────────────────────────────────────────────────────
const TOKEN         = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const USER_NAME      = process.env.BOT_USER_NAME      || 'Kullanıcı';
const ASSISTANT_NAME = process.env.BOT_ASSISTANT_NAME || 'Yeliz';
const TZ             = process.env.BOT_TIMEZONE        || 'Asia/Ho_Chi_Minh';
const MODEL          = 'claude-sonnet-4-6';

if (!TOKEN || !CHAT_ID || !ANTHROPIC_KEY) {
  console.error('❌  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID ve ANTHROPIC_API_KEY gerekli.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const bot       = new TelegramBot(TOKEN, { polling: true });

// ─── State ────────────────────────────────────────────────────────────────────
let tasks       = [];          // { id, title, time, status: 'pending'|'done', postponeCount? }
let routines    = [];          // { id, text, time } — loaded from DB on startup
let idCounter   = 1;
const firedKeys = new Set();   // prevent double-firing
// Tracks unanswered completion checks: taskId → { sentAt, secondSent }
const pendingCompletionChecks = new Map();
let pendingReschedule          = null;  // task.id waiting for a new time from user
let pendingDeleteIds           = [];    // task IDs awaiting delete confirmation
let pendingAnalysisReschedule  = null;  // [{title,time}] incomplete tasks awaiting tomorrow confirm
let lastMessageAt = Date.now(); // used for conversation tracking

// WhatsApp state
let waModule              = null;  // loaded lazily if WA is enabled
let _waCurrentJid         = null;  // JID of the WA sender currently being processed
let _pendingWATaskConfirm = null;  // { jid, title, time } — awaiting Telegram confirmation

// Student monitoring
let studentsModule = null;
try { studentsModule = require('./students'); } catch {}
const _pendingStudentMsgs = new Map(); // shortId → { phone, draft }

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TASKS   = 9999;
const TASK_MIN_M  = 30;   // minimum task block in minutes
const TASK_MAX_M  = 90;   // maximum task block in minutes
const PRE_REMIND  = 10;   // pre-reminder lead time in minutes

const DAY_KEYS    = ['pazar','pazartesi','salı','çarşamba','perşembe','cuma','cumartesi'];
const DAY_LABELS  = { 0:'Pazar',1:'Pazartesi',2:'Salı',3:'Çarşamba',4:'Perşembe',5:'Cuma',6:'Cumartesi' };

// ─── Memory ───────────────────────────────────────────────────────────────────
const _USER_ID_SLUG = (process.env.WEB_USER_ID || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
const MEMORY_FILE = path.join(__dirname, `memory_${_USER_ID_SLUG}.json`);

function loadMemory() {
  try {
    if (fs.existsSync(MEMORY_FILE))
      return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
  } catch { /* ignore */ }
  return { weekly_schedule: {}, rules: [] };
}

function saveMemory(mem) {
  try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2)); } catch { /* ignore */ }
}

function todayDayIndex() {
  // Returns 0=Pazar..6=Cumartesi in Istanbul timezone
  const iso = new Date().toLocaleDateString('sv-SE', { timeZone: TZ }); // YYYY-MM-DD
  return new Date(iso + 'T12:00:00').getDay();
}

function todayKey() {
  const day = new Date().toLocaleDateString('tr-TR', { timeZone: TZ, weekday: 'long' }).toLowerCase();
  return DAY_KEYS.find(k => day.startsWith(k)) || DAY_KEYS[todayDayIndex()];
}

function saveWeeklyActivity(day, activity) {
  const mem = loadMemory();
  if (!mem.weekly_schedule[day]) mem.weekly_schedule[day] = [];
  if (!mem.weekly_schedule[day].includes(activity))
    mem.weekly_schedule[day].push(activity);
  saveMemory(mem);
}

function saveRule(rule) {
  const mem = loadMemory();
  if (!mem.rules.includes(rule)) mem.rules.push(rule);
  saveMemory(mem);
}

function saveSchedule(schedule) {
  const mem = loadMemory();
  if (!mem.schedules) mem.schedules = [];
  // Replace existing schedule with same action+time to avoid duplicates
  const key = s => `${s.action}@${s.time}`;
  mem.schedules = mem.schedules.filter(s => key(s) !== key(schedule));
  mem.schedules.push(schedule);
  saveMemory(mem);
}

function loadSchedules() {
  const mem = loadMemory();
  return mem.schedules || [];
}

// ─── Daily stats helpers ──────────────────────────────────────────────────────
// Returns today's date string YYYY-MM-DD in user timezone
function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// Increment done count for today
function recordDailyDone() {
  const mem = loadMemory();
  if (!mem.daily_stats) mem.daily_stats = {};
  const d = todayISO();
  if (!mem.daily_stats[d]) mem.daily_stats[d] = { done: 0, skipped: 0, postponed: 0 };
  mem.daily_stats[d].done++;
  saveMemory(mem);
  console.log(`[STATS] done++  (today total: ${mem.daily_stats[d].done})`);
}

// Increment postponed count for today + update pattern
function recordDailyPostponed(title) {
  const mem = loadMemory();
  if (!mem.daily_stats) mem.daily_stats = {};
  const d = todayISO();
  if (!mem.daily_stats[d]) mem.daily_stats[d] = { done: 0, skipped: 0, postponed: 0 };
  mem.daily_stats[d].postponed++;
  // Postpone pattern — key by first keyword in title (lowercase, max 20 chars)
  if (title) {
    const key = title.toLowerCase().split(/[\s,]/)[0].slice(0, 20);
    if (!mem.postpone_patterns) mem.postpone_patterns = {};
    mem.postpone_patterns[key] = (mem.postpone_patterns[key] || 0) + 1;
  }
  saveMemory(mem);
  console.log(`[STATS] postponed++ "${title || ''}"`);
}

// Update today's skipped count (remaining pending at EOD, called from runDailyAnalysis)
function updateDailyEODStats() {
  const mem = loadMemory();
  if (!mem.daily_stats) mem.daily_stats = {};
  const d = todayISO();
  if (!mem.daily_stats[d]) mem.daily_stats[d] = { done: 0, skipped: 0, postponed: 0 };
  mem.daily_stats[d].done    = tasks.filter(t => t.status === 'done').length;
  mem.daily_stats[d].skipped = tasks.filter(t => t.status === 'pending').length;
  // Keep at most 90 days of stats to prevent unbounded growth
  const keys = Object.keys(mem.daily_stats).sort();
  if (keys.length > 90) {
    keys.slice(0, keys.length - 90).forEach(k => delete mem.daily_stats[k]);
  }
  saveMemory(mem);
}

// Returns { done, skipped, postponed, rate } for a given date string
function getStatsForDate(dateStr) {
  const mem = loadMemory();
  return (mem.daily_stats || {})[dateStr] || { done: 0, skipped: 0, postponed: 0 };
}

// Returns weekly aggregate (past 7 days including today)
function getWeeklyStats() {
  const today = todayISO();
  let done = 0, skipped = 0, postponed = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(new Date(today).getTime() - i * 86400000).toISOString().split('T')[0];
    const s = getStatsForDate(d);
    done      += s.done;
    skipped   += s.skipped;
    postponed += s.postponed;
  }
  const total = done + skipped + postponed;
  return { done, skipped, postponed, total, rate: total ? Math.round(done / total * 100) : 0 };
}

// ─── Habit tracking helpers ───────────────────────────────────────────────────
// Keyword → habit name mapping (order matters: first match wins)
const HABIT_MAP = [
  { keywords: ['spor', 'egzersiz', 'yürüyüş', 'koşu', 'gym', 'fitness', 'antrenman'], habit: 'spor'       },
  { keywords: ['okuma', 'kitap', 'oku'],                                               habit: 'okuma'      },
  { keywords: ['meditasyon', 'meditasyon', 'yoga', 'nefes'],                           habit: 'meditasyon' },
  { keywords: ['diyet', 'sağlıklı', 'su iç'],                                          habit: 'sağlık'     },
  { keywords: ['ders', 'ödev', 'çalış'],                                               habit: 'çalışma'    },
];

function detectHabit(title) {
  const lower = (title || '').toLowerCase();
  for (const { keywords, habit } of HABIT_MAP) {
    if (keywords.some(kw => lower.includes(kw))) return habit;
  }
  return null;
}

// Update habit streak on task done/notdone. Returns event object or null.
function updateHabitStreak(title, done) {
  const habit = detectHabit(title);
  if (!habit) return null;

  const mem = loadMemory();
  if (!mem.habits) mem.habits = {};

  const today     = todayISO();
  const yesterday = new Date(new Date(today).getTime() - 86400000).toISOString().split('T')[0];
  const entry     = mem.habits[habit] || { streak: 0, last_done: null, total: 0 };

  if (!done) {
    // Task not completed — break streak if it was active
    if (entry.streak > 0 && entry.last_done !== today) {
      const broken = entry.streak;
      entry.streak = 0;
      mem.habits[habit] = entry;
      saveMemory(mem);
      console.log(`[HABIT] ${habit}: seri kırıldı (${broken} gündü)`);
      return { broken: true, habit, streak: broken };
    }
    return null;
  }

  // Task completed
  if (entry.last_done === today) return null; // already counted today

  if (entry.last_done === yesterday || entry.streak === 0) {
    entry.streak++;
  } else {
    entry.streak = 1; // gap in streak
  }
  entry.last_done = today;
  entry.total++;
  mem.habits[habit] = entry;
  saveMemory(mem);
  console.log(`[HABIT] ${habit}: streak=${entry.streak}, total=${entry.total}`);

  const MILESTONES = [7, 14, 30, 60, 100];
  if (MILESTONES.includes(entry.streak)) {
    return { milestone: true, habit, streak: entry.streak };
  }
  return { updated: true, habit, streak: entry.streak };
}

// Build habit milestone message
function habitMilestoneMsg(result) {
  if (!result) return '';
  if (result.broken) {
    return result.streak > 0
      ? `\n\n💔 ${result.habit} serisi kırıldı! (${result.streak} günlük seriydi). Yarın devam et 💪`
      : '';
  }
  if (result.milestone) {
    const emoji = result.streak >= 100 ? '🏆🏆🏆' : result.streak >= 60 ? '🏆🏆' : result.streak >= 30 ? '🏆' : '🔥';
    const label = { 7: '1 hafta', 14: '2 hafta', 30: '1 ay', 60: '2 ay', 100: '100 gün' }[result.streak] || `${result.streak} gün`;
    return `\n\n${emoji} ${result.habit.toUpperCase()} ${label.toUpperCase()} SERİSİ! Harika iş!`;
  }
  if (result.updated && result.streak > 1) {
    return `\n🔥 ${result.habit} serisi: ${result.streak} gün`;
  }
  return '';
}

// ─── Weather (Open-Meteo, no API key needed) ──────────────────────────────────
const WMO_CODES = {
  0: 'Güneşli ☀️', 1: 'Güneşli ☀️', 2: 'Parçalı bulutlu ⛅', 3: 'Bulutlu 🌥️',
  45: 'Sisli 🌫️', 48: 'Sisli 🌫️',
  51: 'Çisenti 🌦️', 53: 'Çisenti 🌦️', 55: 'Çisenti 🌦️',
  61: 'Yağmurlu 🌧️', 63: 'Yağmurlu 🌧️', 65: 'Yağmurlu 🌧️',
  71: 'Karlı 🌨️', 73: 'Karlı 🌨️', 75: 'Karlı 🌨️', 77: 'Karlı 🌨️',
  80: 'Sağanak 🌦️', 81: 'Sağanak 🌦️', 82: 'Sağanak 🌦️',
  95: 'Fırtınalı ⛈️', 96: 'Fırtınalı ⛈️', 99: 'Fırtınalı ⛈️',
};

function weatherDesc(code) {
  return WMO_CODES[code] || 'Bulutlu 🌥️';
}

async function getWeather() {
  const lat = process.env.WEATHER_LAT || '41.01';
  const lon = process.env.WEATHER_LON || '28.97';
  const url = `/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto&forecast_days=1`;

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.open-meteo.com',
      path:     url,
      method:   'GET',
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          const c = data.current;
          resolve({
            temp: Math.round(c.temperature_2m),
            desc: weatherDesc(c.weather_code),
            wind: Math.round(c.wind_speed_10m),
          });
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// ─── Google Sheets: kişi bağlamı (service account) ───────────────────────────
const SHEETS_ID = process.env.SHEETS_ID || '1DW3bbhhbBrC6VSohdskedhb_iVDI-VJO_FOjB1nRAkc';

async function getPersonContext(attendeeNames) {
  const saEmail = process.env.GOOGLE_SA_EMAIL;
  const saKey   = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!saEmail || !saKey) return 'YOK';
  const names = (attendeeNames || []).map(n => n.trim()).filter(Boolean);
  if (!names.length) return 'YOK';
  try {
    const { google } = require('googleapis');
    const auth = new google.auth.JWT(saEmail, null, saKey, [
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ]);
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEETS_ID,
      range: 'KİŞİLER!A:H',
    });
    const rows     = res.data.values || [];
    const dataRows = rows[0]?.[0]?.toLowerCase() === 'ad' ? rows.slice(1) : rows;
    const matches  = [];
    for (const name of names) {
      const nameLower = name.toLowerCase();
      const row = dataRows.find(r => r[0] && r[0].toLowerCase().trim() === nameLower);
      if (!row) continue;
      const [ad, , sonGorusme, anaKonu, bekleyenAksiyonlar, , sonrakiAdim] = row;
      matches.push(
        `${ad}\nSon görüşme: ${sonGorusme || '-'}\nKonu: ${anaKonu || '-'}\nBekleyen: ${bekleyenAksiyonlar || '-'}\nSonraki adım: ${sonrakiAdim || '-'}`
      );
    }
    return matches.length ? matches.join('\n\n---\n\n') : 'YOK';
  } catch (e) {
    console.error('[SHEETS] getPersonContext hatası:', e.message);
    return 'YOK';
  }
}

// ─── Time utilities (pure math — not NLP) ────────────────────────────────────
const pad    = n => String(n).padStart(2, '0');
const nowHH  = () => new Date().toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');

function parseTime(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{1,2})[.:](\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1]), min = parseInt(m[2]);
  if (h > 23 || min > 59) return null;
  return pad(h) + ':' + pad(min);
}

function addMins(hhmm, n) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = ((h * 60 + m + n) % 1440 + 1440) % 1440;
  return pad(Math.floor(t / 60)) + ':' + pad(t % 60);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ─── Task helpers ─────────────────────────────────────────────────────────────
function slotTaken(time) {
  return tasks.some(t => t.time === time && t.status === 'pending');
}

// project is optional — if provided, groups tasks visually
function addTask(title, time, project) {
  const task = { id: `t${idCounter++}`, title, time, status: 'pending', ...(project ? { project } : {}) };
  tasks.push(task);
  console.log(`[ADD] ${task.time} — ${task.title}${project ? ` [${project}]` : ''}`);
  dbAdapter?.syncTask(task);
  return task;
}

function pendingTasks() {
  return tasks.filter(t => t.status === 'pending').sort((a, b) => a.time.localeCompare(b.time));
}

function sortedTasks() {
  return [...tasks].sort((a, b) => a.time.localeCompare(b.time));
}

function planText() {
  if (!tasks.length) return '📋 Görev yok.';
  const sorted = sortedTasks();

  // Group by project when any task has a project tag
  if (sorted.some(t => t.project)) {
    const groups = {};
    const noProj = [];
    for (const t of sorted) {
      if (t.project) { (groups[t.project] = groups[t.project] || []).push(t); }
      else noProj.push(t);
    }
    let out = '📋 Bugünün planı:\n';
    for (const [proj, ptasks] of Object.entries(groups)) {
      out += `\n📁 ${proj}\n`;
      ptasks.forEach(t => { out += `  ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}\n`; });
    }
    if (noProj.length) {
      out += '\n📁 Genel\n';
      noProj.forEach(t => { out += `  ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}\n`; });
    }
    return out.trim();
  }

  return '📋 Bugünün planı:\n\n' +
    sorted.map((t, i) => `${i + 1}. ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}`).join('\n');
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
const send = text => bot.sendMessage(CHAT_ID, text);

// Send to Telegram and/or WhatsApp based on WA_NOTIFY_CHANNEL env
function notifyAll(text) {
  const ch = (process.env.WA_NOTIFY_CHANNEL || 'telegram').toLowerCase();
  if (ch === 'telegram' || ch === 'both') send(text);
  if ((ch === 'whatsapp' || ch === 'both') && waModule) {
    const { connected, phone } = waModule.getWAStatus();
    if (connected && phone) waModule.sendWA(phone, text).catch(() => {});
  }
}

function sendButtons(text, buttons) {
  return bot.sendMessage(CHAT_ID, text, {
    reply_markup: {
      inline_keyboard: [
        buttons.map(b => ({ text: b.label, callback_data: b.data }))
      ]
    }
  });
}

function fireCompletionCheck(task) {
  pendingCompletionChecks.set(task.id, { sentAt: Date.now(), secondSent: false });
  return sendButtons(
    `${task.title} tamamlandı mı?`,
    [
      { label: '✅ Evet',   data: `DONE:${task.id}` },
      { label: '❌ Hayır',  data: `NOTDONE:${task.id}` },
      { label: '⏭ Ertele', data: `POSTPONE:2h:${task.id}` },
    ]
  );
}

// ─── Agent: conversation history ─────────────────────────────────────────────
const conversationHistory = [];
const MAX_HISTORY = 20;  // keep more history since it's persisted

// Remove orphaned tool_result blocks (no matching tool_use in previous assistant message)
function sanitizeHistory(history) {
  const validToolUseIds = new Set();
  for (const msg of history) {
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'tool_use') validToolUseIds.add(block.id);
      }
    }
  }
  return history.filter(msg => {
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const hasOrphan = msg.content.some(
        b => b.type === 'tool_result' && !validToolUseIds.has(b.tool_use_id)
      );
      if (hasOrphan) return false;
    }
    return true;
  });
}

function trimHistory() {
  // Trim to MAX_HISTORY before sanitizing to avoid spreading a huge array
  while (conversationHistory.length > MAX_HISTORY) {
    conversationHistory.shift();
  }
  // Remove orphaned tool_result blocks caused by the trim
  const cleaned = sanitizeHistory([...conversationHistory]);
  conversationHistory.length = 0;
  for (const msg of cleaned) conversationHistory.push(msg);
}

// Debounced history save — only writes to DB 3s after last change
let _historySaveTimer = null;
function scheduleSaveHistory() {
  if (!dbAdapter) return;
  clearTimeout(_historySaveTimer);
  _historySaveTimer = setTimeout(() => {
    dbAdapter.saveConversationHistory(conversationHistory);
  }, 3000);
}

// Static part — cached (rarely changes)
function buildStaticSystem() {
  const mem = loadMemory();

  let sys = `Sen ${ASSISTANT_NAME}'sin — ${USER_NAME}'in kişisel icra asistanısın.
Görevin günlük operasyonları yönetmek, önceliklendirmek ve hayatını kolaylaştırmak.

## Temel Kurallar
- Dil: Türkçe. Samimi ama profesyonel.
- Kısa yaz. Telefonda kolayca taranabilecek uzunluk.
- Liste değil, karar ver. "3 toplantın var" değil, "odak zamanın kısıtlı, şunu öne al" de.
- Tek seferde tek soru sor. Cevabı al, devam et.
- Emojileri işaret olarak kullan: 🔴 Kritik/Aksiyon, 🟡 Önemli/Bekleyebilir, ✅ Tamamlandı, ⏭ Ertelendi, 📅 Takvim, 📧 Mail

## Zaman Dilimi
UTC+7 (Vietnam / Ho Chi Minh). Tüm saatler bu zaman dilimine göre hesaplanır.
Tarihten bahsederken her zaman açıkça belirt: "Bugün [Gün], [Tarih]..."

## Öncelik Hiyerarşisi
Deadline > Toplantı > Görev > Mail
Çakışma veya sıkışma olduğunda bu sıraya göre yönlendir. Her zaman somut bir öneride bulun.

## Araçlar ve Görev Yönetimi
- Araçları kullanarak görevleri gerçek olarak yönet, sadece söz verme
- Görevi silmeden önce onay iste (delete_tasks confirmed:false ile)
- Takvim işlemleri için get_calendar_events / add_calendar_event kullan
- E-posta analizi için analyze_emails kullan
- Zaman için get_current_time kullan — tahmin etme, ölç

## Öğrenilen Bilgiler`;

  if (mem.rules.length) {
    sys += `\n${mem.rules.join('\n')}`;
  } else {
    sys += `\nHenüz kişisel bilgi kaydedilmedi.`;
  }

  if (routines.length) {
    sys += `\n\n## Kayıtlı Rutinler\n` + routines.map(r =>
      `- ${r.time ? `${r.time} — ` : ''}${r.text}`
    ).join('\n');
  }

  // Erteleme uyarıları
  if (mem.postpone_patterns) {
    const top = Object.entries(mem.postpone_patterns)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .filter(([, v]) => v >= 2);
    if (top.length) {
      sys += `\n\n## Sık Ertelenenler\n` +
        top.map(([k, v]) => `- "${k}" ${v}x ertelendi`).join('\n');
    }
  }

  // Aktif alışkanlık serileri
  if (mem.habits) {
    const active = Object.entries(mem.habits).filter(([, h]) => h.streak > 0);
    if (active.length) {
      sys += `\n\n## Aktif Alışkanlık Serileri\n` +
        active.map(([k, h]) => `- ${k}: ${h.streak} gün`).join('\n');
    }
  }

  return sys;
}

// Dynamic part — NOT cached (changes every message)
function buildDynamicContext() {
  const current   = nowHH();
  const dayName   = DAY_LABELS[todayDayIndex()] || '';
  const todayDate = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
  const mem       = loadMemory();
  const dayItems  = mem.weekly_schedule[todayKey()] || [];
  const taskList  = tasks.length
    ? sortedTasks().map((t, i) => `${i + 1}. [${t.status}] ${t.time} — ${t.title}`).join('\n')
    : 'Görev yok.';
  const pending = pendingTasks().length;

  // Daily stats for today and yesterday
  const statsToday = getStatsForDate(todayDate);
  const yesterday  = new Date(new Date(todayDate).getTime() - 86400000).toISOString().split('T')[0];
  const statsYday  = getStatsForDate(yesterday);
  const ydayTotal  = statsYday.done + statsYday.skipped + statsYday.postponed;
  const ydayRate   = ydayTotal ? Math.round(statsYday.done / ydayTotal * 100) : null;

  let ctx = `## Anlık Durum (UTC+7)
Bugün: ${dayName}, ${todayDate} | Saat: ${current}
Bekleyen: ${pending} | Tamamlanan: ${statsToday.done} | Ertelenen: ${statsToday.postponed}
${ydayRate !== null ? `Dün: %${ydayRate} (${statsYday.done}/${ydayTotal})` : ''}
${pendingReschedule ? `⚠️ Erteleme bekliyor: görev ID ${pendingReschedule}` : ''}

## Bugünkü Görevler
${taskList}`;

  if (mem.calendar_today && mem.calendar_today.length) {
    ctx += `\n\n## Takvim (Bugün)
timeMin: bugün 00:00 UTC+7 | timeMax: bugün 23:59 UTC+7\n` + mem.calendar_today.map(e => `- ${e}`).join('\n');
  }

  if (dayItems.length) {
    ctx += `\n\n## Hafıza (${dayName})\n${dayItems.join(', ')}`;
  }

  return ctx;
}

const AGENT_TOOLS = [
  {
    name: 'add_task',
    description: 'Yeni görev ekle. Gelecek bir tarih için date parametresi kullan (yarın, cumartesi, 3 gün sonra gibi). Bugün için date boş bırak. Proje bağlamı varsa project parametresi ekle.',
    input_schema: {
      type: 'object',
      properties: {
        time:    { type: 'string', description: 'HH:MM formatında saat' },
        title:   { type: 'string', description: 'Görev başlığı' },
        date:    { type: 'string', description: 'YYYY-MM-DD formatında tarih — sadece gelecek tarihler için. Bugün için boş bırak.' },
        project: { type: 'string', description: 'Proje adı (opsiyonel) — örn: "İş", "Kişisel", "Sağlık"' },
      },
      required: ['time', 'title'],
    },
  },
  {
    name: 'edit_task',
    description: 'Mevcut görevin başlığını değiştir.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Görev saati (HH:MM), sıra numarası veya anahtar kelime' },
        new_title:  { type: 'string', description: 'Yeni başlık' },
      },
      required: ['identifier', 'new_title'],
    },
  },
  {
    name: 'delete_tasks',
    description: 'Görev veya görevleri sil. confirmed:false ile önce onay al.',
    input_schema: {
      type: 'object',
      properties: {
        identifiers: { type: 'string', description: '"1,2,3" sıra numaraları, "all" tüm görevler veya anahtar kelime' },
        confirmed:   { type: 'boolean', description: 'Kullanıcı silmeyi onayladı mı?' },
      },
      required: ['identifiers', 'confirmed'],
    },
  },
  {
    name: 'mark_done',
    description: 'Görevi tamamlandı olarak işaretle.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Görev saati (HH:MM), sıra numarası veya anahtar kelime. "last" son bekleyen görevi işaretler.' },
      },
      required: ['identifier'],
    },
  },
  {
    name: 'reschedule_task',
    description: 'Görevi yeni saate taşı.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Görev saati (HH:MM), sıra numarası veya anahtar kelime' },
        new_time:   { type: 'string', description: 'Yeni saat HH:MM' },
      },
      required: ['identifier', 'new_time'],
    },
  },
  {
    name: 'create_daily_plan',
    description: 'Kullanıcının açıklamasından günlük plan oluştur ve görevleri ekle.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Kullanıcının plan açıklaması veya günün içeriği' },
      },
      required: ['description'],
    },
  },
  {
    name: 'get_plan',
    description: 'Bugünkü görev listesini getir ve göster.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_memory',
    description: 'Kullanıcı hakkında öğrenilen her şeyi hafızaya kaydet: meslek, çalışma saatleri, alışkanlıklar, tercihler, haftalık program, kişisel kurallar. Onboarding cevaplarını mutlaka kaydet.',
    input_schema: {
      type: 'object',
      properties: {
        type:  { type: 'string', enum: ['weekly_schedule', 'rule'], description: 'Hafıza türü — kişisel bilgi/tercih/alışkanlık için "rule" kullan' },
        day:   { type: 'string', description: 'Gün (sadece weekly_schedule için): pazar|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi' },
        value: { type: 'string', description: 'Kaydedilecek bilgi — açıklayıcı ve net yaz' },
      },
      required: ['type', 'value'],
    },
  },
  {
    name: 'analyze_emails',
    description: 'Gmail e-postalarını analiz et ve aksiyon öğelerini çıkar.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_routine',
    description: 'Günlük rutin veya alışkanlık kaydet. "Her gün sabah X\'te Y yap", "hergün yapılacaklar" gibi taleplerde kullan. Web uygulamasına kaydeder, kalıcıdır. [Otomatik rutin tetiklendi] prefix\'li mesajlarda KULLANMA — o durumda eylemi direkt gerçekleştir.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Rutin açıklaması (örn: "Her gün sabah 7\'de günlük plan özeti gönder")' },
        time: { type: 'string', description: 'HH:MM formatında saat (opsiyonel)' },
      },
      required: ['text'],
    },
  },
  {
    name: 'get_routines',
    description: 'Kayıtlı günlük rutinleri listele. Kullanıcı rutinlerini sormak veya görmek istediğinde kullan.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_current_time',
    description: 'Güncel İstanbul saatini ve tarihini al. Saat sorulduğunda veya zamana bağlı karar verirken kullan.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_calendar_events',
    description: 'Google Takvim etkinliklerini getir. Kullanıcı takviminden etkinlik sormak veya günün planını görmek istediğinde kullan.',
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD formatında tarih. Boş bırakılırsa bugün.' },
      },
      required: [],
    },
  },
  {
    name: 'set_schedule',
    description: 'Kullanıcının "her gece X\'te Y yap" gibi tekrarlayan zamanlı bir görev tanımlamasını hafızaya kaydet. Sadece açıkça tekrarlayan bir zamanlama istendiğinde kullan.',
    input_schema: {
      type: 'object',
      properties: {
        time:        { type: 'string', description: 'HH:MM formatında saat (örn: "00:00")' },
        action:      { type: 'string', enum: ['daily_analysis'], description: 'Yapılacak eylem. Şimdilik sadece "daily_analysis" destekleniyor.' },
        description: { type: 'string', description: 'Kullanıcıya gösterilecek açıklama' },
      },
      required: ['time', 'action', 'description'],
    },
  },
  {
    name: 'track_habit',
    description: 'Alışkanlık takip listesini göster — aktif seriler, toplam sayılar ve son yapılma tarihleri.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'group_by_project',
    description: 'Bugünkü görevleri proje klasörlerine göre gruplu göster.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'send_whatsapp_message',
    description: 'Belirtilen telefon numarasına WhatsApp mesajı gönder. WhatsApp bağlı olmalı. Kullanıcı "WhatsApp\'tan mesaj gönder" veya belirli bir numaraya mesaj atmak istediğinde kullan.',
    input_schema: {
      type: 'object',
      properties: {
        phone:   { type: 'string', description: 'Telefon numarası — ülke kodu dahil, örn: 905321234567' },
        message: { type: 'string', description: 'Gönderilecek mesaj metni' },
      },
      required: ['phone', 'message'],
    },
  },
  {
    name: 'add_student',
    description: 'Mentörlük öğrencisi ekle. İsim ve WhatsApp numarası zorunlu. Grup adı opsiyonel (örn: "Grup A", "Ocak Kohort"). Öğrenci WhatsApp grubundan mesaj attığında aktivitesi otomatik takip edilecek.',
    input_schema: {
      type: 'object',
      properties: {
        name:  { type: 'string', description: 'Öğrencinin adı soyadı' },
        phone: { type: 'string', description: 'WhatsApp numarası — ülke kodu dahil, örn: 905321234567' },
        group: { type: 'string', description: 'Grup adı (opsiyonel), örn: "Grup A"' },
      },
      required: ['name', 'phone'],
    },
  },
  {
    name: 'list_students',
    description: 'Kayıtlı öğrencileri listele. Grup filtresi ile sadece o gruptakileri göster. Aktivite durumunu (son görülme, sessizlik günü) gösterir.',
    input_schema: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Filtrele: sadece bu gruptaki öğrenciler (opsiyonel)' },
      },
      required: [],
    },
  },
  {
    name: 'student_report',
    description: 'Öğrenci aktivite raporu: kim kaç gündür sessiz, son ne yazdı, bu hafta kaç mesaj attı. Sessizlik eşiği belirlenebilir.',
    input_schema: {
      type: 'object',
      properties: {
        min_silent_days: { type: 'number', description: 'Bu kadar gün ve üzeri sessiz olanları göster (varsayılan: 1)' },
      },
      required: [],
    },
  },
  {
    name: 'send_student_message',
    description: 'İsim veya numara ile öğrenciye WhatsApp mesajı gönder. WhatsApp bağlı olmalı.',
    input_schema: {
      type: 'object',
      properties: {
        identifier: { type: 'string', description: 'Öğrenci adı (kısmi eşleşme) veya telefon numarası' },
        message:    { type: 'string', description: 'Gönderilecek mesaj' },
      },
      required: ['identifier', 'message'],
    },
  },
];

// ─── Claude: daily planner ────────────────────────────────────────────────────
const PLANNER_SYSTEM = `Sen bir günlük plan oluşturucususun. Görevleri zaman bloklarına yerleştir.

Kurallar:
- Her görev 30-90 dakika
- Görev sayısı sınırsız, gün içine sığacak kadar ekle
- Çakışan zaman yok
- Gündüz (09:00-17:00) → planlama, araştırma, yazı, toplantı
- Akşam (17:00-21:00) → çekim, prodüksiyon, uygulama
- Akış: fikir → planlama → uygulama/çekim
- Benzer görevleri birleştir

SADECE JSON döndür: [{"time":"HH:MM","title":"görev başlığı"}]`;

async function generateDailyPlan(userText) {
  const current    = nowHH();
  const mem        = loadMemory();
  const dayName    = DAY_LABELS[todayDayIndex()] || '';
  const dayItems   = mem.weekly_schedule[todayKey()] || [];
  const existTimes = pendingTasks().map(t => t.time);

  let ctx = `Şu an: ${current}, Gün: ${dayName}\n`;
  if (dayItems.length) ctx += `Hafıza (bugün): ${dayItems.join(', ')}\n`;
  if (mem.rules.length) ctx += `Alışkanlıklar: ${mem.rules.join('; ')}\n`;
  if (existTimes.length) ctx += `Dolu saatler: ${existTimes.join(', ')}\n`;
  ctx += `\nKullanıcı mesajı:\n"${userText}"\n\nSadece JSON.`;

  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024,
      system: PLANNER_SYSTEM,
      messages: [{ role: 'user', content: ctx }],
    });
    const match = r.content[0].text.trim().match(/\[[\s\S]*\]/);
    if (match) {
      const blocks = JSON.parse(match[0]).filter(b => b.time && b.title);
      return blocks;
    }
  } catch (e) {
    console.error('[PLANNER] Hata:', e.message);
  }
  return null;
}

// ─── Daily analysis ───────────────────────────────────────────────────────────
async function runDailyAnalysis() {
  updateDailyEODStats(); // snapshot skipped count before analyzing
  const done    = tasks.filter(t => t.status === 'done');
  const pending = tasks.filter(t => t.status === 'pending');
  const total   = tasks.length;

  let summary = '';
  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 512,
      system: `Sen ${ASSISTANT_NAME}, ${USER_NAME}'in asistanısın. Kısa, samimi ve motive edici bir günlük analiz yaz.`,
      messages: [{
        role: 'user', content:
          `Bugünün görev özeti:\n` +
          `- Toplam: ${total}\n` +
          `- Tamamlanan (${done.length}): ${done.map(t => t.title).join(', ') || 'yok'}\n` +
          `- Tamamlanmayan (${pending.length}): ${pending.map(t => t.title).join(', ') || 'yok'}\n\n` +
          `2-3 cümle ile samimi bir değerlendirme yaz. Başarıları kutla, tamamlanmayanlar için de motive et.`,
      }],
    });
    summary = r.content[0].text.trim();
  } catch (e) {
    summary = done.length
      ? `${USER_NAME}, bugün ${done.length} görev tamamladınız 🎉`
      : `${USER_NAME}, bugün görev tamamlanmadı.`;
  }

  send(`🌙 *Gece Analizi*\n\n${summary}`);

  if (pending.length > 0) {
    pendingAnalysisReschedule = pending.map(t => ({ title: t.title, time: t.time }));
    const list = pending.map(t => `• ${t.time} — ${t.title}`).join('\n');
    send(`📋 Tamamlanmayan ${pending.length} görev:\n${list}\n\nYarına aynı saatlerde ekleyeyim mi? (Evet / Hayır)`);
  }
}

// ─── Schedule registration ────────────────────────────────────────────────────
const registeredSchedules = new Set();

function registerSchedule(s) {
  const key = `${s.action}@${s.time}`;
  if (registeredSchedules.has(key)) return; // already registered
  registeredSchedules.add(key);

  const [h, m] = s.time.split(':').map(Number);
  const cronExpr = `${m} ${h} * * *`;

  cron.schedule(cronExpr, () => {
    console.log(`[CRON] Zamanlama tetiklendi: ${s.description}`);
    if (s.action === 'daily_analysis') runDailyAnalysis();
    else if (s.action === 'routine' && s.text) {
      const trigger = `[Otomatik rutin tetiklendi — yeni kayıt oluşturma, sadece şimdi yap]: ${s.text}`;
      runAgent(trigger).catch(e => console.error('[CRON] Rutin hatası:', e.message));
    }
  }, { timezone: TZ });

  console.log(`[CRON] Zamanlama kaydedildi: ${s.description} (${cronExpr})`);
}

function registerSavedSchedules() {
  const schedules = loadSchedules();
  schedules.forEach(registerSchedule);
  if (schedules.length) console.log(`[SYS] ${schedules.length} kayıtlı zamanlama yüklendi.`);
}

// ─── Groq: voice → text ───────────────────────────────────────────────────────
async function transcribeVoice(fileId) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) return null;

  const fileLink = await bot.getFileLink(fileId);
  const chunks = [];
  await new Promise((resolve, reject) => {
    https.get(fileLink, res => {
      res.on('data', c => chunks.push(c));
      res.on('end', resolve);
      res.on('error', reject);
    }).on('error', reject);
  });
  const audioBuffer = Buffer.concat(chunks);

  // Send to Groq Whisper via multipart form
  const boundary = '----FormBoundary' + Date.now();
  const filename = 'voice.ogg';
  const disposition = `form-data; name="file"; filename="${filename}"`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: ${disposition}\r\nContent-Type: audio/ogg\r\n\r\n`),
    audioBuffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\ntr\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  return new Promise((resolve, reject) => {
    const req = require('https').request({
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data.text || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Claude: image → tasks ────────────────────────────────────────────────────
function downloadPhoto(fileId) {
  return bot.getFileLink(fileId).then(url => new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, res => {
      res.on('data', c => chunks.push(c));
      res.on('end',  () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  }));
}

async function extractTasksFromPhoto(buffer, caption) {
  const b64 = buffer.toString('base64');
  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 1024,
      system: 'Görselden görevleri çıkar. Saatler varsa al. SADECE JSON döndür: [{"title":"görev","time":"HH:MM veya null"}]',
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text',  text: caption ? `Açıklama: "${caption}"\nGörevleri çıkar.` : 'Görevleri çıkar.' },
      ]}],
    });
    const match = r.content[0].text.trim().match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]).filter(i => i.title);
  } catch (e) { console.error('[VISION] Hata:', e.message); }
  return [];
}

async function handlePhoto(msg) {
  send('⏳ Fotoğraf analiz ediliyor...');

  let buffer;
  try {
    buffer = await downloadPhoto(msg.photo[msg.photo.length - 1].file_id);
  } catch {
    send('❌ Fotoğraf indirilemedi.');
    return;
  }

  const items = await extractTasksFromPhoto(buffer, (msg.caption || '').trim());
  if (!items.length) { send('❌ Fotoğrafta görev bulunamadı.'); return; }

  // Items with a time → add directly
  const withTime    = items.filter(i => i.time && parseTime(i.time));
  const withoutTime = items.filter(i => !i.time || !parseTime(i.time));
  const added       = [];

  for (const item of withTime) {
    const t = parseTime(item.time);
    if (slotTaken(t)) continue;
    added.push(addTask(item.title, t));
  }

  // Items without a time → plan them
  if (withoutTime.length) {
    const plan = await generateDailyPlan(withoutTime.map(i => i.title).join(', '));
    if (plan && plan.length) {
      for (const b of plan) {
        const t = parseTime(b.time);
        if (!t || slotTaken(t)) continue;
        added.push(addTask(b.title, t));
      }
    }
  }

  if (!added.length) { send('❌ Görev eklenemedi (slot dolu).'); return; }
  send('✅ Eklendi:\n' + added.map(t => `${t.time} — ${t.title}`).join('\n'));
}

// ─── Agent: tool helpers ──────────────────────────────────────────────────────
function findTask(identifier) {
  if (!identifier) return null;
  const id = String(identifier).trim();

  if (id === 'last') {
    return [...tasks].reverse().find(t => t.status === 'pending') || null;
  }

  // Index number
  const num = parseInt(id);
  if (!isNaN(num) && num >= 1) {
    const sorted = sortedTasks();
    const t = sorted[num - 1];
    return (t && t.status === 'pending') ? t : null;
  }

  // HH:MM time
  const parsed = parseTime(id);
  if (parsed) {
    return tasks.find(t => t.time === parsed && t.status === 'pending') || null;
  }

  // Keyword search
  const kw = id.toLowerCase();
  return tasks.find(t => t.status === 'pending' && t.title.toLowerCase().includes(kw)) || null;
}

async function executeTool(name, input) {
  switch (name) {

    case 'add_task': {
      const t = parseTime(input.time);
      if (!t) return `❌ Geçersiz saat: ${input.time}`;

      // Future date: save to DB only, not in-memory
      if (input.date) {
        const today = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
        if (input.date > today) {
          const futureTask = { id: `t${idCounter++}`, title: input.title, time: t, status: 'pending' };
          dbAdapter?.syncTask(futureTask, input.date);
          return `✅ ${input.date} tarihine eklendi: ${t} — ${input.title}`;
        }
      }

      if (slotTaken(t)) return `❌ ${t} saatinde zaten görev var.`;

      // WhatsApp source: ask for Telegram confirmation before adding
      if (_waCurrentJid && !_pendingWATaskConfirm) {
        _pendingWATaskConfirm = { jid: _waCurrentJid, title: input.title, time: t };
        sendButtons(
          `📲 *WhatsApp'tan görev:*\n\n⏳ ${t} — ${input.title}\n\nEkleyeyim mi?`,
          [
            { label: '✅ Evet, ekle', data: 'WA_CONFIRM:yes' },
            { label: '❌ Hayır',      data: 'WA_CONFIRM:no' },
          ]
        );
        return `Telegram onayı bekleniyor: "${t} — ${input.title}"`;
      }

      const task = addTask(input.title, t, input.project || null);
      const projLabel = task.project ? ` [${task.project}]` : '';
      return `✅ Eklendi: ${task.time} — ${task.title}${projLabel}`;
    }

    case 'edit_task': {
      const task = findTask(input.identifier);
      if (!task) return `❌ "${input.identifier}" görev bulunamadı.`;
      const old = task.title;
      task.title = input.new_title;
      firedKeys.delete(`fire:${task.id}:${task.time}`);
      firedKeys.delete(`pre:${task.id}:${task.time}`);
      dbAdapter?.syncTask(task);
      return `✅ Güncellendi: ${task.time} — ${old} → ${task.title}`;
    }

    case 'delete_tasks': {
      const sorted = sortedTasks();
      let toDelete = [];

      if (String(input.identifiers) === 'all') {
        toDelete = sorted.filter(t => t.status === 'pending');
      } else {
        const nums = String(input.identifiers).split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
        if (nums.length) {
          toDelete = nums.map(n => sorted[n - 1]).filter(t => t && t.status === 'pending');
        } else {
          const found = findTask(input.identifiers);
          if (found) toDelete = [found];
        }
      }

      if (!toDelete.length) return '❌ Silinecek görev bulunamadı.';

      if (!input.confirmed) {
        pendingDeleteIds = toDelete.map(t => t.id);
        return `Şunları silmek istiyor musunuz?\n${toDelete.map(t => `• ${t.time} — ${t.title}`).join('\n')}\n\nEvet / Hayır?`;
      }

      const deleted = tasks.filter(t => toDelete.map(x => x.id).includes(t.id));
      tasks = tasks.filter(t => !toDelete.map(x => x.id).includes(t.id));
      deleted.forEach(t => dbAdapter?.deleteTask(t.id));
      pendingDeleteIds = [];
      return `🗑 Silindi:\n${deleted.map(t => `• ${t.time} — ${t.title}`).join('\n')}`;
    }

    case 'mark_done': {
      const task = findTask(input.identifier) ||
        (pendingReschedule ? tasks.find(t => t.id === pendingReschedule) : null) ||
        [...tasks].reverse().find(t => t.status === 'pending');
      if (!task) return '❌ Tamamlanacak bekleyen görev yok.';
      task.status = 'done';
      pendingReschedule = null;
      dbAdapter?.updateTaskStatus(task.id, 'done');
      // Record daily stat + check habit streak
      recordDailyDone();
      const habitResult = updateHabitStreak(task.title, true);
      return `✅ Tamamlandı: ${task.time} — ${task.title}${habitMilestoneMsg(habitResult)}`;
    }

    case 'reschedule_task': {
      const task = findTask(input.identifier) ||
        (pendingReschedule ? tasks.find(t => t.id === pendingReschedule) : null);
      if (!task) return `❌ "${input.identifier}" görev bulunamadı.`;
      const newTime = parseTime(input.new_time);
      if (!newTime) return `❌ Geçersiz saat: ${input.new_time}`;
      if (slotTaken(newTime)) return `❌ ${newTime} saati dolu.`;
      const old = task.time;
      firedKeys.delete(`fire:${task.id}:${old}`);
      firedKeys.delete(`pre:${task.id}:${old}`);
      task.time = newTime;
      pendingReschedule = null;
      dbAdapter?.syncTask(task);
      // Record postpone stat + pattern
      recordDailyPostponed(task.title);
      return `✅ Taşındı: ${task.time} — ${task.title}`;
    }

    case 'create_daily_plan': {
      const blocks = await generateDailyPlan(input.description);
      if (!blocks || !blocks.length) return '❌ Plan oluşturulamadı.';
      const added = [];
      for (const b of blocks) {
        const t = parseTime(b.time);
        if (!t || slotTaken(t)) continue;
        added.push(addTask(b.title, t));
      }
      if (!added.length) return '❌ Tüm slotlar dolu.';
      return `Plan hazır!\n${added.map(t => `⏳ ${t.time} — ${t.title}`).join('\n')}`;
    }

    case 'get_plan':
      return planText();

    case 'save_memory': {
      if (input.type === 'weekly_schedule' && input.day) {
        saveWeeklyActivity(input.day.toLowerCase(), input.value);
        return `🧠 Haftalık programa eklendi: ${input.day} — ${input.value}`;
      } else {
        saveRule(input.value);
        return `🧠 Alışkanlık kaydedildi: ${input.value}`;
      }
    }

    case 'save_routine': {
      const routineText = input.text;
      const routineTime = input.time || null;
      // Save to web app DB
      dbAdapter?.saveRoutine(routineText, routineTime);
      // If time given, also persist as a cron schedule so it survives restarts
      if (routineTime) {
        const s = { time: routineTime, action: 'routine', text: routineText, description: routineText };
        saveSchedule(s);
        registerSchedule(s);
        return `🔁 Rutin kaydedildi ve zamanlama oluşturuldu: "${routineText}" — Her gün ${routineTime}'da otomatik çalışacak.`;
      }
      return `🔁 Günlük rutin kaydedildi: "${routineText}" — Web uygulamasında Günlük Rutinler bölümünde görünür.`;
    }

    case 'get_routines': {
      if (!dbAdapter) return '❌ DB bağlantısı yok.';
      const routines = await dbAdapter.getRoutines();
      if (!routines.length) return '📋 Kayıtlı günlük rutin yok.';
      return '📋 Günlük rutinler:\n' + routines.map((r, i) =>
        `${i + 1}. ${r.time ? `${r.time} — ` : ''}${r.text}`
      ).join('\n');
    }

    case 'get_current_time': {
      const t = nowHH();
      const d = new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
      const day = DAY_LABELS[todayDayIndex()] || '';
      return `🕐 Şu an: ${t} | Tarih: ${d} (${day}) — İstanbul saati`;
    }

    case 'get_calendar_events': {
      if (!dbAdapter) return '❌ DB bağlantısı yok.';
      const calDate = input.date || new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
      const events = await dbAdapter.getCalendarEvents(calDate);
      if (events && events.error) return `❌ Google Takvim hatası: ${events.error}`;
      if (!Array.isArray(events) || events.length === 0) return `📅 ${calDate} tarihinde Google Takvim'de etkinlik yok.`;
      return `📅 Google Takvim (${calDate}):\n` + events.map(e =>
        `• ${e.allDay ? 'Tüm gün' : e.start} — ${e.title}${e.location ? ` 📍 ${e.location}` : ''}`
      ).join('\n');
    }

    case 'set_schedule': {
      const s = { time: input.time, action: input.action, description: input.description };
      saveSchedule(s);
      registerSchedule(s);
      return `⏰ Zamanlama kaydedildi: Her gece ${s.time}'da ${s.description} — aktif!`;
    }

    case 'analyze_emails': {
      try {
        const webUrl    = process.env.WEB_APP_URL || 'http://localhost:3000';
        const botSecret = process.env.BOT_SECRET || 'organic-bot-internal';
        const userId    = process.env.WEB_USER_ID || '';
        const res  = await fetch(`${webUrl}/api/email/bot-analyze`, {
          method: 'POST',
          headers: {
            'x-bot-secret':  botSecret,
            'x-bot-user-id': userId,
          },
        });
        const data = await res.json();

        if (!res.ok) {
          const errorMsg = data.error || 'E-postalar alınamadı.';

          // Auth expired or not connected → send reconnect button to Telegram
          if (data.errorType === 'auth_expired' || data.errorType === 'not_connected') {
            const webAppUrl = process.env.WEB_APP_URL_PUBLIC || webUrl;
            bot.sendMessage(CHAT_ID, `⚠️ ${errorMsg}\n\nGmail bağlantısını yenilemek için aşağıdaki butona tıklayın:`, {
              reply_markup: {
                inline_keyboard: [[
                  { text: '🔗 Gmail\'i Yeniden Bağla', url: `${webAppUrl}/settings` },
                ]],
              },
            });
            return `⚠️ ${errorMsg}`;
          }

          return `❌ ${errorMsg}`;
        }

        const { summary, actionItems, emailCount } = data;
        const typeIcons = { meeting: '🗓', action: '✅', deadline: '⏰', info: 'ℹ️' };
        const priorityMark = { high: '🔴', medium: '🟡', low: '🟢' };

        let result = `📧 *${emailCount} e-posta analiz edildi*\n`;
        if (summary) result += `\n${summary}\n`;

        if (actionItems?.length) {
          result += `\n*Aksiyon gerektiren (${actionItems.length}):*\n`;
          actionItems.forEach((item, i) => {
            const icon = typeIcons[item.type] || '•';
            const prio = priorityMark[item.priority] || '';
            result += `\n${i + 1}. ${icon} ${prio} *${item.title}*`;
            if (item.time) result += `\n   ⏱ ${item.time}`;
            if (item.from) result += `\n   📨 ${item.from}`;
          });
        } else {
          result += '\n✅ Bugün için aksiyon gerektiren e-posta yok.';
        }
        return result;
      } catch (e) {
        return `❌ E-posta analizi başarısız: ${e.message}`;
      }
    }

    case 'track_habit': {
      const mem = loadMemory();
      const habits = mem.habits || {};
      if (!Object.keys(habits).length) {
        return '📊 Henüz takip edilen alışkanlık yok.\nGörevler tamamlandıkça otomatik algılanır (spor, okuma, meditasyon vb.)';
      }
      const lines = ['📊 *Alışkanlık Takibi:*'];
      for (const [habit, h] of Object.entries(habits).sort(([,a],[,b]) => b.streak - a.streak)) {
        const fire = h.streak >= 30 ? '🏆' : h.streak >= 7 ? '🔥' : h.streak >= 3 ? '⭐' : '•';
        lines.push(`${fire} ${habit}: ${h.streak} gün seri | Toplam: ${h.total} | Son: ${h.last_done || '-'}`);
      }
      return lines.join('\n');
    }

    case 'group_by_project': {
      if (!tasks.length) return '📋 Görev yok.';
      const grouped = {};
      const noProj  = [];
      for (const t of sortedTasks()) {
        if (t.project) { (grouped[t.project] = grouped[t.project] || []).push(t); }
        else noProj.push(t);
      }
      if (!Object.keys(grouped).length) return planText();
      let out = '📋 *Görevler (Projeye Göre):*';
      for (const [proj, ptasks] of Object.entries(grouped)) {
        out += `\n\n📁 *${proj}*\n`;
        ptasks.forEach(t => { out += `  ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}\n`; });
      }
      if (noProj.length) {
        out += '\n📁 *Genel*\n';
        noProj.forEach(t => { out += `  ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}\n`; });
      }
      return out.trim();
    }

    case 'send_whatsapp_message': {
      if (!waModule) return '❌ WhatsApp entegrasyonu aktif değil (WA_ENABLED=true ayarlayın).';
      const { connected } = waModule.getWAStatus();
      if (!connected) return '❌ WhatsApp bağlı değil. Telegram\'dan bağlantı kurun.';
      try {
        await waModule.sendWA(input.phone, input.message);
        return `✅ WhatsApp mesajı gönderildi → ${input.phone}`;
      } catch (e) {
        return `❌ WhatsApp mesajı gönderilemedi: ${e.message}`;
      }
    }

    case 'add_student': {
      if (!studentsModule) return '❌ Öğrenci modülü yüklenemedi.';
      const result = studentsModule.addStudent(input.name, input.phone, input.group || '');
      if (result.error) return `❌ ${result.error}`;
      return `✅ Öğrenci eklendi: ${result.name} (${result.phone})${result.group ? ` — Grup: ${result.group}` : ''}`;
    }

    case 'list_students': {
      if (!studentsModule) return '❌ Öğrenci modülü yüklenemedi.';
      const list = studentsModule.loadStudents();
      if (!list.length) return '📋 Henüz öğrenci kaydı yok. "add_student" ile ekle.';
      const filtered = input.group
        ? list.filter(s => s.group?.toLowerCase().includes(input.group.toLowerCase()))
        : list;
      if (!filtered.length) return `❌ "${input.group}" grubunda öğrenci yok.`;
      const activity = studentsModule.loadActivity();
      const today = todayISO();
      const lines = [`👥 ${filtered.length} öğrenci:\n`];
      const byGroup = {};
      for (const s of filtered) {
        const g = s.group || 'Grup yok';
        (byGroup[g] = byGroup[g] || []).push(s);
      }
      for (const [grp, students] of Object.entries(byGroup)) {
        lines.push(`📁 ${grp}`);
        for (const s of students) {
          const act = activity[s.phone] || {};
          const lastDate = act.lastMessageDate;
          const daysSilent = lastDate
            ? Math.max(0, Math.floor((Date.now() - new Date(lastDate + 'T00:00:00').getTime()) / 86400000))
            : 999;
          const status = daysSilent === 999 ? '❓ hiç mesaj yok'
            : daysSilent === 0 ? '🟢 bugün aktif'
            : daysSilent === 1 ? '🟡 dün aktif'
            : daysSilent <= 3 ? `🟠 ${daysSilent}g sessiz`
            : `🔴 ${daysSilent === 999 ? '??' : daysSilent}g sessiz`;
          lines.push(`  ${s.name} · ${status}`);
        }
      }
      return lines.join('\n');
    }

    case 'student_report': {
      if (!studentsModule) return '❌ Öğrenci modülü yüklenemedi.';
      const minDays = input.min_silent_days ?? 1;
      const report = studentsModule.getStudentReport().filter(s => s.daysSilent >= minDays);
      if (!report.length) return `✅ ${minDays}+ gün sessiz öğrenci yok! Herkes aktif.`;
      const lines = [`📊 ${minDays}+ gün sessiz öğrenciler (${report.length}):\n`];
      for (const s of report) {
        const days = s.daysSilent === 999 ? 'hiç mesaj atmadı' : `${s.daysSilent} gündür sessiz`;
        const last = s.lastMessage ? `\n    Son: "${s.lastMessage.slice(0, 60)}"` : '';
        const flag = s.flag === 'critical' ? '🔴' : s.flag === 'warning' ? '🟠' : '🟡';
        lines.push(`${flag} ${s.name}${s.group ? ` (${s.group})` : ''} — ${days}${last}`);
      }
      return lines.join('\n');
    }

    case 'send_student_message': {
      if (!studentsModule) return '❌ Öğrenci modülü yüklenemedi.';
      if (!waModule) return '❌ WhatsApp entegrasyonu aktif değil.';
      const { connected } = waModule.getWAStatus();
      if (!connected) return '❌ WhatsApp bağlı değil.';
      const students = studentsModule.loadStudents();
      const lower    = input.identifier.toLowerCase();
      const clean    = input.identifier.replace(/\D/g, '');
      const found    = students.find(s =>
        s.name.toLowerCase().includes(lower) ||
        (clean.length >= 5 && s.phone === clean)
      );
      if (!found) return `❌ "${input.identifier}" adında/numarasında öğrenci bulunamadı.`;
      try {
        await waModule.sendWA(found.phone, input.message);
        return `✅ ${found.name}'e (${found.phone}) WhatsApp mesajı gönderildi.`;
      } catch (e) {
        return `❌ Gönderilemedi: ${e.message}`;
      }
    }

    default:
      return `❌ Bilinmeyen araç: ${name}`;
  }
}

// ─── Agent: main loop ─────────────────────────────────────────────────────────
// waJid: optional WhatsApp JID — if set, response is also sent to WA
async function runAgentFromWA(text, jid) {
  _waCurrentJid = jid;
  try {
    await runAgent(text);
  } finally {
    _waCurrentJid = null;
  }
}

async function runAgent(userText) {
  conversationHistory.push({ role: 'user', content: userText });
  trimHistory();

  const messages = [...conversationHistory];

  for (let round = 0; round < 8; round++) {
    let response;
    try {
      response = await anthropic.messages.create(
        {
          model: MODEL,
          max_tokens: 1024,
          system: [
            { type: 'text', text: buildStaticSystem(), cache_control: { type: 'ephemeral' } },
            { type: 'text', text: buildDynamicContext() },
          ],
          tools: AGENT_TOOLS,
          messages,
        },
        { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' } }
      );
    } catch (e) {
      console.error('[AGENT] Claude hatası:', e.message);
      send(`Üzgünüm ${USER_NAME}, bir hata oluştu. Tekrar dener misiniz? 🙏`);
      return;
    }

    const toolUses = response.content.filter(c => c.type === 'tool_use');

    if (response.stop_reason === 'end_turn' || !toolUses.length) {
      const finalText = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (finalText) {
        // Send to Telegram always; also to WhatsApp if request came from WA
        send(finalText);
        if (_waCurrentJid && waModule) {
          const ch = (process.env.WA_NOTIFY_CHANNEL || 'telegram').toLowerCase();
          if (ch === 'whatsapp' || ch === 'both') {
            waModule.sendWA(_waCurrentJid, finalText).catch(() => {});
          }
        }
        conversationHistory.push({ role: 'assistant', content: response.content });
        trimHistory();
        scheduleSaveHistory();
      }
      return;
    }

    // Add assistant's tool-use message to history
    messages.push({ role: 'assistant', content: response.content });
    conversationHistory.push({ role: 'assistant', content: response.content });

    // Execute tools and collect results
    const toolResults = [];
    for (const toolUse of toolUses) {
      console.log(`[AGENT] Araç: ${toolUse.name}`, JSON.stringify(toolUse.input));
      const result = await executeTool(toolUse.name, toolUse.input);
      console.log(`[AGENT] Sonuç: ${result}`);
      toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: result });
    }

    const toolResultMsg = { role: 'user', content: toolResults };
    messages.push(toolResultMsg);
    conversationHistory.push(toolResultMsg);
    trimHistory();
  }

  send(`Üzgünüm ${USER_NAME}, işlem tamamlanamadı. Tekrar dener misiniz?`);
}

// ─── Scheduler (30s) ─────────────────────────────────────────────────────────
setInterval(() => {
  const now = nowHH();

  for (const task of tasks.filter(t => t.status === 'pending')) {
    // 10 min pre-reminder
    const preKey = `pre:${task.id}:${task.time}`;
    if (!firedKeys.has(preKey) && now === addMins(task.time, -PRE_REMIND)) {
      firedKeys.add(preKey);
      send(`${task.time} → ${task.title} — 10 dakikan var.`);
      console.log(`[PRE] ${task.title}`);
    }

    // Completion check 10 min after task time
    const fireKey = `fire:${task.id}:${task.time}`;
    if (!firedKeys.has(fireKey) && now === addMins(task.time, 10)) {
      firedKeys.add(fireKey);
      console.log(`[FIRE] ${task.title} (${task.time})`);
      fireCompletionCheck(task);
    }
  }

  // Second-chance completion check: re-ask after 20 min of no response
  const twentyMin = 20 * 60 * 1000;
  for (const [taskId, info] of pendingCompletionChecks) {
    if (info.secondSent) continue;
    if (Date.now() - info.sentAt < twentyMin) continue;
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.status !== 'pending') { pendingCompletionChecks.delete(taskId); continue; }
    info.secondSent = true;
    sendButtons(
      `${task.title} tamamlandı mı?`,
      [
        { label: '✅ Evet',   data: `DONE:${task.id}` },
        { label: '❌ Hayır',  data: `NOTDONE:${task.id}` },
        { label: '⏭ Ertele', data: `POSTPONE:2h:${task.id}` },
      ]
    );
    console.log(`[FIRE2] İkinci hatırlatma: ${task.title}`);
  }
}, 30_000);

// ─── Callback handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async query => {
  await bot.answerCallbackQuery(query.id);
  const data = query.data;

  // ── WhatsApp task confirmation ─────────────────────────────────────────────
  if (data.startsWith('WA_CONFIRM:')) {
    if (data === 'WA_CONFIRM:yes' && _pendingWATaskConfirm) {
      const { jid, title, time } = _pendingWATaskConfirm;
      if (slotTaken(time)) {
        send(`❌ ${time} saatinde zaten başka bir görev var.`);
        waModule?.sendWA(jid, `❌ ${time} saatinde başka görev var.`).catch(() => {});
      } else {
        const task = addTask(title, time);
        send(`✅ WhatsApp görevi eklendi: ${task.time} — ${task.title}`);
        waModule?.sendWA(jid, `✅ Görev eklendi: ${task.time} — ${task.title}`).catch(() => {});
      }
    } else if (_pendingWATaskConfirm) {
      send('❌ WhatsApp görevi eklenmedi.');
      waModule?.sendWA(_pendingWATaskConfirm.jid, '❌ Görev eklenmedi.').catch(() => {});
    }
    _pendingWATaskConfirm = null;
    return;
  }

  // ── Student follow-up quick-send ──────────────────────────────────────────
  if (data.startsWith('SEND_STUDENT:')) {
    const btnId   = data.slice('SEND_STUDENT:'.length);
    const pending = _pendingStudentMsgs.get(btnId);
    if (!pending) { send('❌ Bu buton artık geçerli değil.'); return; }
    if (!waModule) { send('❌ WhatsApp aktif değil.'); return; }
    const { connected } = waModule.getWAStatus();
    if (!connected) { send('❌ WhatsApp bağlı değil.'); return; }
    try {
      await waModule.sendWA(pending.phone, pending.draft);
      send(`✅ *${pending.name}*'e mesaj gönderildi:\n_${pending.draft}_`);
      _pendingStudentMsgs.delete(btnId);
    } catch (e) {
      send(`❌ Gönderilemedi: ${e.message}`);
    }
    return;
  }

  if (data.startsWith('DONE:')) {
    const task = tasks.find(t => t.id === data.slice(5));
    if (task) {
      task.status = 'done';
      pendingReschedule = null;
      pendingCompletionChecks.delete(task.id);
      dbAdapter?.updateTaskStatus(task.id, 'done');
      const habitResult = updateHabitStreak(task.title, true);
      const habitMsg    = habitMilestoneMsg(habitResult);
      send(`✅ ${task.title} tamamlandı.${habitMsg}`);
      console.log(`[DONE] ${task.title}`);
    }
    return;
  }

  if (data.startsWith('NOTDONE:')) {
    const taskId = data.slice(8);
    const task   = tasks.find(t => t.id === taskId);
    if (task) {
      pendingReschedule = task.id;
      pendingCompletionChecks.delete(taskId);
      task.postponeCount = (task.postponeCount || 0) + 1;
      recordDailyPostponed(task.title);
      // Check habit streak break
      const habitResult = updateHabitStreak(task.title, false);
      if (habitResult?.broken) {
        send(habitMilestoneMsg(habitResult).trim());
      }

      // Postpone count warnings per spec
      if (task.postponeCount === 2) {
        bot.sendMessage(CHAT_ID,
          `🔴 "${task.title}" bugün 2 kez ertelendi.\nYarına mı taşıyalım?`,
          { reply_markup: { inline_keyboard: [[
            { text: '🌙 Yarına taşı', callback_data: `POSTPONE:tomorrow:${taskId}` },
            { text: '🕐 2 saat sonra', callback_data: `POSTPONE:2h:${taskId}` },
          ]] } }
        );
        return;
      }
      if (task.postponeCount >= 3) {
        bot.sendMessage(CHAT_ID,
          `🔴 "${task.title}" 3 kez ertelendi.\nNe yapalım?`,
          { reply_markup: { inline_keyboard: [
            [{ text: '🌙 Yarına taşı', callback_data: `POSTPONE:tomorrow:${taskId}` }],
            [{ text: '🗑 Sil',          callback_data: `DELETE_TASK:${taskId}` }],
            [{ text: '📤 Devret',       callback_data: `POSTPONE:reason:${taskId}` }],
          ] } }
        );
        return;
      }

      // Default: smart postpone 3 options
      bot.sendMessage(CHAT_ID,
        `📌 ${task.title}\n\nNe yapalım?`,
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🕐 2 saat sonra',    callback_data: `POSTPONE:2h:${taskId}` },
                { text: '🌙 Yarına',           callback_data: `POSTPONE:tomorrow:${taskId}` },
              ],
              [{ text: '📝 Neden erteledin?', callback_data: `POSTPONE:reason:${taskId}` }],
            ],
          },
        }
      );
    }
    return;
  }

  // ── Smart postpone actions ─────────────────────────────────────────────────
  if (data.startsWith('POSTPONE:')) {
    const [, action, ...rest] = data.split(':');
    const taskId = rest.join(':');
    const task   = tasks.find(t => t.id === taskId);

    if (action === '2h') {
      if (task) {
        const newTime = addMins(task.time, 120);
        if (!slotTaken(newTime)) {
          const old = task.time;
          firedKeys.delete(`fire:${task.id}:${old}`);
          firedKeys.delete(`pre:${task.id}:${old}`);
          pendingCompletionChecks.delete(task.id);
          task.time = newTime;
          dbAdapter?.syncTask(task);
          pendingReschedule = null;
          send(`⏭ "${task.title}" → ${newTime}`);
          console.log(`[POSTPONE] 2h: ${task.title} → ${newTime}`);
        } else {
          send(`❌ ${newTime} saatinde başka görev var. Farklı bir saat yazın:`);
        }
      }
      return;
    }

    if (action === 'tomorrow') {
      if (task) {
        const tomorrow    = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('sv-SE', { timeZone: TZ });
        const newId       = `t${idCounter++}`;
        dbAdapter?.syncTask({ id: newId, title: task.title, time: task.time, status: 'pending', ...(task.project ? { project: task.project } : {}) }, tomorrowStr);
        task.status = 'done';
        dbAdapter?.updateTaskStatus(task.id, 'done');
        pendingReschedule = null;
        pendingCompletionChecks.delete(task.id);
        send(`⏭ "${task.title}" yarına (${task.time}) taşındı.`);
        console.log(`[POSTPONE] tomorrow: ${task.title}`);
      }
      return;
    }

    if (action === 'reason') {
      if (task) {
        bot.sendMessage(CHAT_ID, `"${task.title}" için neden erteliyorsunuz?`, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '⏰ Zamanım olmadı',    callback_data: `REASON:time:${taskId}` },
                { text: '😴 Yorgunum',           callback_data: `REASON:tired:${taskId}` },
              ],
              [
                { text: '🔄 Önceliğim değişti', callback_data: `REASON:priority:${taskId}` },
                { text: '💭 Diğer',              callback_data: `REASON:other:${taskId}` },
              ],
            ],
          },
        });
      }
      return;
    }
  }

  // ── Postpone reason logging ────────────────────────────────────────────────
  if (data.startsWith('REASON:')) {
    const [, reason, ...rest] = data.split(':');
    const taskId  = rest.join(':');
    const task    = tasks.find(t => t.id === taskId);
    const REASON_MAP = { time: 'Zamanım olmadı', tired: 'Yorgunluk', priority: 'Öncelik değişimi', other: 'Diğer' };
    const reasonText = REASON_MAP[reason] || reason;

    const mem = loadMemory();
    if (!mem.postpone_reasons) mem.postpone_reasons = [];
    mem.postpone_reasons.push({
      task: task?.title || taskId,
      reason: reasonText,
      date: todayISO(),
    });
    if (mem.postpone_reasons.length > 50) mem.postpone_reasons = mem.postpone_reasons.slice(-50);
    saveMemory(mem);

    if (task) pendingReschedule = task.id;
    send(`📝 Neden kaydedildi: "${reasonText}".\n${task ? 'Kaça taşıyalım? Saati yazın.' : ''}`);
    console.log(`[REASON] ${task?.title || taskId}: ${reasonText}`);
    return;
  }

  // ── Quick task delete (from postpone-3x flow) ─────────────────────────────
  if (data.startsWith('DELETE_TASK:')) {
    const taskId = data.slice('DELETE_TASK:'.length);
    const idx    = tasks.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const title = tasks[idx].title;
      tasks.splice(idx, 1);
      pendingCompletionChecks.delete(taskId);
      pendingReschedule = null;
      dbAdapter?.deleteTask?.(taskId);
      send(`🗑 "${title}" silindi.`);
      console.log(`[DELETE] ${title}`);
    }
    return;
  }
});

// ─── Photo handler ────────────────────────────────────────────────────────────
bot.on('photo', async msg => {
  if (String(msg.chat.id) !== String(CHAT_ID)) return;
  await handlePhoto(msg);
});

// ─── Voice handler ────────────────────────────────────────────────────────────
bot.on('voice', async msg => {
  if (String(msg.chat.id) !== String(CHAT_ID)) return;
  send('🎙️ Ses mesajı alındı, çevriliyor...');
  const text = await transcribeVoice(msg.voice.file_id);
  if (!text) {
    send('⚠️ Ses mesajı çevrilemedi. GROQ_API_KEY ayarlı mı?');
    return;
  }
  send(`📝 Anladım: "${text}"`);
  lastMessageAt   = Date.now();
  await runAgent(text);
});

// ─── Message handler ──────────────────────────────────────────────────────────
bot.on('message', async msg => {
  if (String(msg.chat.id) !== String(CHAT_ID)) return;
  if (msg.photo) return;
  if (msg.voice) return;

  const text = (msg.text || '').trim();
  if (!text) return;

  console.log(`[MSG] "${text}"`);

  // Reset inactivity on every message
  lastMessageAt   = Date.now();

  // ── Analysis reschedule intercept ─────────────────────────────────────────
  if (pendingAnalysisReschedule) {
    const lower = text.toLowerCase().trim();
    if (/^(evet|yes|ok|tamam|ekle|ekleyin|ekleyiver)$/.test(lower)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      const added = [];
      for (const t of pendingAnalysisReschedule) {
        const newId = `t${idCounter++}`;
        dbAdapter?.syncTask({ id: newId, title: t.title, time: t.time, status: 'pending' }, tomorrowStr);
        added.push(t);
      }
      pendingAnalysisReschedule = null;
      send(`✅ ${added.length} görev yarına eklendi:\n${added.map(t => `• ${t.time} — ${t.title}`).join('\n')}`);
      return;
    } else if (/^(hayır|hayir|no|vazgeç|vazgec|istemiyorum)$/.test(lower)) {
      pendingAnalysisReschedule = null;
      send(`Tamam ${USER_NAME}, eklemedim. İyi geceler! 🌙`);
      return;
    }
    // Unrelated message — clear state and process normally
    pendingAnalysisReschedule = null;
  }

  // ── Delete confirmation intercept ──────────────────────────────────────────
  if (pendingDeleteIds.length > 0) {
    const lower = text.toLowerCase().trim();
    if (/^(evet|yes|ok|tamam|sil|onayla)$/.test(lower)) {
      const deleted = tasks.filter(t => pendingDeleteIds.includes(t.id));
      tasks = tasks.filter(t => !pendingDeleteIds.includes(t.id));
      pendingDeleteIds = [];
      send(`🗑 Silindi ${USER_NAME}:\n` + deleted.map(t => `• ${t.time} — ${t.title}`).join('\n'));
      return;
    } else if (/^(hayır|hayir|no|vazgeç|vazgec|iptal)$/.test(lower)) {
      pendingDeleteIds = [];
      send(`✅ Tamam ${USER_NAME}, iptal edilmedi.`);
      return;
    } else {
      // Unrelated message — clear confirm state and process normally
      pendingDeleteIds = [];
    }
  }

  try {
    await runAgent(text);
  } catch (err) {
    console.error('[MSG] Kritik hata:', err.message);
    send(`Üzgünüm ${USER_NAME}, bir hata oluştu. Tekrar dener misiniz? 🙏`);
  }
});

// ─── Global error guards (prevent silent crashes) ─────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UNCAUGHT] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT] uncaughtException:', err.message);
});

// ─── Stdin command listener (from web app / bot-manager) ──────────────────────
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', async (line) => {
  const cmd = line.trim();
  if (cmd === 'WA_CONNECT') {
    console.log('[CMD] WA_CONNECT alındı.');
    if (!waModule) {
      waModule = (() => { try { return require('./whatsapp'); } catch (e) { console.warn('[WA] whatsapp.js yüklenemedi:', e.message); return null; } })();
    }
    if (waModule) {
      waModule.reconnectWA().catch(e => console.error('[CMD] WA_CONNECT hatası:', e.message));
    }
  } else if (cmd === 'WA_DISCONNECT') {
    console.log('[CMD] WA_DISCONNECT alındı.');
    if (waModule) {
      waModule.disconnectWA().catch(e => console.error('[CMD] WA_DISCONNECT hatası:', e.message));
    }
  }
});

// ─── Cron: 07:30 — morning briefing ──────────────────────────────────────────
cron.schedule('30 7 * * *', async () => {
  console.log('[CRON] 07:30 sabah brifing başlatılıyor...');
  try {
    const dayName    = DAY_LABELS[todayDayIndex()] || '';
    const todayDate  = todayISO();
    const mem        = loadMemory();
    const calEvents  = mem.calendar_today || [];
    const pending    = pendingTasks();

    // Yesterday's stats
    const yesterday = new Date(new Date(todayDate).getTime() - 86400000).toISOString().split('T')[0];
    const ystStats  = getStatsForDate(yesterday);
    const ystTotal  = ystStats.done + ystStats.skipped + ystStats.postponed;

    // Deferred tasks from yesterday (tasks still pending that were added before today)
    const deferred  = pending.filter(t => {
      const addedDate = t.addedDate;
      return addedDate && addedDate < todayDate;
    });

    // Person context from Google Sheets (service account)
    const attendees     = mem.calendar_attendees || [];
    const personContext = await getPersonContext(attendees);

    // Build context for Claude
    const ctx = [
      `Bugün: ${dayName}, ${todayDate} (UTC+7)`,
      ystTotal ? `Dün: ${ystStats.done}/${ystTotal} görev tamamlandı` : 'Dün: veri yok',
    ];
    if (calEvents.length) {
      ctx.push(`\nTakvim (${calEvents.length} etkinlik):`);
      calEvents.forEach(e => ctx.push(`  ${e}`));
    }
    if (pending.length) {
      ctx.push(`\nGörevler (${pending.length}):`);
      pending.forEach(t => ctx.push(`  ${t.time} — ${t.title}`));
    } else {
      ctx.push('Bugün görev yok.');
    }
    if (deferred.length) {
      ctx.push(`\nDünden devredenler: ${deferred.map(t => t.title).join(', ')}`);
    }

    // Build template variables
    const tplTarih    = `${dayName}, ${todayDate}`;
    const tplTakvim   = calEvents.length
      ? calEvents.join('\n')
      : 'Takvimde etkinlik yok.';
    const tplErtelenen = deferred.length
      ? deferred.map(t => `${t.time} — ${t.title}`).join('\n')
      : 'Yok.';

    const userPrompt =
`Bugünün tarihi: ${tplTarih}
Takvim verisi: ${tplTakvim}
Dünden ertelenen: ${tplErtelenen}

=== BUGÜNKÜ TOPLANTI KİŞİLERİNİN GEÇMİŞİ ===
${personContext}

Şu kurallara göre sabah mesajını yaz:

1. İlk satır sadece:
   "Günaydın Alp. [Gün], [Tarih]."

2. İkinci satır tek cümle özet.
   Sadece o günün verisine dayan.
   Hava durumu, motivasyon, "haydi başlayalım" yazma.

3. Görevleri saat sırasıyla listele.
   Aynı saatte birden fazla varsa:
   Uzun süreli = ana blok
   Kısa süreli = o bloğun altına ↳ ile yaz
   Çakışıyor deme.

4. Dünden ertelenen görev varsa boş slota yerleştir,
   "X görevi [saat]'e aldım" diye bildir.
   Yoksa hiç yazma.

5. En sona bugün kazanılması gereken 3 şeyi yaz.
   Spesifik çıktı olsun, genel tavsiye değil.

6. Gerçekten kritik bir şey yoksa uyarı yazma.

ÇIKTI FORMAT:
Günaydın Alp. [Gün], [Tarih].
[Tek cümle özet]

BUGÜNÜN PLANI
[SS:DD] — [Görev]
[SS:DD] — [Görev]
  ↳ [Alt görev]

BUGÜN KAZANMAN GEREKEN 3 ŞEY
1.
2.
3.`;

    let briefing;
    try {
      const r = await anthropic.messages.create({
        model: MODEL, max_tokens: 600,
        system: `Sen Alp'in icra asistanısın. Adın Yeliz.
Zaman dilimi: UTC+7 (Vietnam - Ho Chi Minh City).
Kısa yaz. Motivasyon yok. Gerçek var.
Emojileri işaret olarak kullan, dekorasyon olarak değil.
Markdown kullanma. Yıldız, diyez, kalın yazı yok.
Düz metin yaz, Telegram'da bozulmasın.`,
        messages: [{ role: 'user', content: userPrompt }],
      });
      briefing = r.content[0].text.trim();
    } catch {
      const planLines = pending.slice(0, 5).map(t => `${t.time} — ${t.title}`).join('\n') || 'Görev yok.';
      briefing = `Günaydın Alp. ${tplTarih}.\nGörevler yükleniyor.\n\nBUGÜNÜN PLANI\n${planLines}\n\nBUGÜN KAZANMAN GEREKEN 3 ŞEY\n1.\n2.\n3.`;
    }

    notifyAll(briefing);
    console.log('[CRON] 07:30 brifing gönderildi.');

    // ── Student follow-up analysis (runs after main briefing) ──────────────
    if (studentsModule) {
      try {
        const summary = studentsModule.getMorningSummary();
        if (summary && (summary.critical.length + summary.warning.length) > 0) {
          const needAttention = [...summary.critical, ...summary.warning].slice(0, 8);

          // Ask Claude to draft a personal WA message for each student
          const studentContext = needAttention.map(s =>
            `- ${s.name}${s.group ? ` (${s.group})` : ''}: ${s.daysSilent === 999 ? 'hiç mesaj atmadı' : `${s.daysSilent} gündür sessiz`}${s.lastMessage ? `, son yazdığı: "${s.lastMessage.slice(0, 80)}"` : ''}`
          ).join('\n');

          let drafts = [];
          try {
            const r = await anthropic.messages.create({
              model: MODEL, max_tokens: 600,
              system: `Sen ${ASSISTANT_NAME}, bir mentörün asistanısın. Her öğrenci için kısa, samimi, Türkçe bir WhatsApp mesajı taslağı yaz. Mentörün adı ${USER_NAME}. Mesajlar 1-2 cümle, doğal ve sıcak olmalı. SADECE JSON döndür: [{"name":"...","draft":"..."}]`,
              messages: [{
                role: 'user',
                content: `Aşağıdaki öğrenciler için takip mesajı taslağı yaz:\n${studentContext}`,
              }],
            });
            const raw = r.content[0].text.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
            drafts = JSON.parse(raw);
          } catch {
            drafts = needAttention.map(s => ({
              name:  s.name,
              draft: `Merhaba ${s.name.split(' ')[0]}! Nasıl gidiyorsun? Bir süredir görüşemedik.`,
            }));
          }

          // Build Telegram message with inline [Gönder] buttons
          const studentLines = [`\n📚 *${needAttention.length} öğrenci takip gerekiyor:*\n`];
          const keyboard     = [];

          for (let i = 0; i < drafts.length; i++) {
            const s     = needAttention[i];
            const draft = (drafts[i]?.draft || `Merhaba ${s.name.split(' ')[0]}, nasılsın?`);
            const days  = s.daysSilent === 999 ? 'hiç aktif olmadı' : `${s.daysSilent}g sessiz`;
            const flag  = s.flag === 'critical' ? '🔴' : '🟠';

            studentLines.push(`${flag} *${s.name}* — ${days}`);
            studentLines.push(`_"${draft}"_`);

            // Store draft in Map with short ID (Telegram callback_data max 64 bytes)
            const btnId = `sm${Date.now()}_${i}`;
            _pendingStudentMsgs.set(btnId, { phone: s.phone, name: s.name, draft });
            keyboard.push([{ text: `📨 ${s.name.split(' ')[0]}'e Gönder`, callback_data: `SEND_STUDENT:${btnId}` }]);
          }

          if (summary.total > 0) {
            studentLines.push(`\n_Toplam ${summary.total} öğrenci · ${summary.active.length} aktif · ${summary.critical.length + summary.warning.length} takip gerekli_`);
          }

          bot.sendMessage(CHAT_ID, studentLines.join('\n'), {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard },
          });
          console.log(`[CRON] ${needAttention.length} öğrenci takip mesajı gönderildi.`);
        }
      } catch (e) {
        console.error('[CRON] Öğrenci analizi hatası:', e.message);
      }
    }
  } catch (e) {
    console.error('[CRON] 07:30 brifing hatası:', e.message);
  }
}, { timezone: TZ });

// ─── Cron: 13:00 — midday check ──────────────────────────────────────────────
cron.schedule('0 13 * * *', async () => {
  console.log('[CRON] 13:00 öğle kontrolü...');
  try {
    const done    = tasks.filter(t => t.status === 'done').length;
    const total   = tasks.length;
    const crits   = pendingTasks().slice(0, 2);

    const lines = [`📊 Günün yarısı.`, ``, `Tamamlanan: ${done} / ${total} görev`];
    if (crits.length) lines.push(`Kalan kritik: ${crits.map(t => `${t.time} ${t.title}`).join(', ')}`);

    // Check if any upcoming task needs prep time
    const now  = nowHH();
    const soon = pendingTasks().find(t => {
      const diff = toMinutes(t.time) - toMinutes(now);
      return diff > 0 && diff <= 90;
    });
    if (soon) {
      const diff = toMinutes(soon.time) - toMinutes(now);
      if (diff >= 25) lines.push(``, `📅 ${soon.time} için ${diff} dakikan var — hazırlık gerekiyorsa şimdi başla.`);
    }

    notifyAll(lines.join('\n'));
  } catch (e) {
    console.error('[CRON] 13:00 hatası:', e.message);
  }
}, { timezone: TZ });

// ─── Cron: 18:30 — evening close ─────────────────────────────────────────────
cron.schedule('30 18 * * *', async () => {
  console.log('[CRON] 18:30 akşam kapanışı...');
  try {
    updateDailyEODStats();
    const done    = tasks.filter(t => t.status === 'done');
    const pending = pendingTasks();

    // Tomorrow's tasks (from DB if available)
    const tomorrow    = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('sv-SE', { timeZone: TZ });
    const tomorrowTasks = (dbAdapter?.getTasksForDate?.(tomorrowStr) || []).slice(0, 3);

    // Move pending tasks to tomorrow
    const moved = [];
    for (const t of pending) {
      moved.push(`– ${t.title} → Yarın ${t.time}'e aldım`);
    }

    // Build context for Claude
    const ctx = [
      `Bugün tamamlanan: ${done.length}`,
      pending.length ? `Tamamlanmayan: ${pending.map(t => t.title).join(', ')}` : '',
      tomorrowTasks.length ? `Yarın: ${tomorrowTasks.map(t => `${t.time} ${t.title}`).join(', ')}` : '',
    ].filter(Boolean);

    let msg;
    try {
      const r = await anthropic.messages.create({
        model: MODEL, max_tokens: 500,
        system: `Sen ${ASSISTANT_NAME}, ${USER_NAME}'in kişisel icra asistanısın. Akşam kapanış mesajını tam olarak bu formatta üret (Türkçe, kısa):

🌙 Bugünün özeti.

✅ Tamamlanan: X görev
⏭ Yarına taşınan:
  – [Görev] → Yarın [SS:DD]'e aldım
(taşınan yoksa bu satırları atla)

📅 YARIN'IN İLK 3 ÖNCELİĞİ
1. ...
2. ...
3. ...

İyi akşamlar.

Yarının önceliklerini bugünün bitmeyenlerine ve takvime göre belirle.`,
        messages: [{ role: 'user', content: ctx.join('\n') }],
      });
      msg = r.content[0].text.trim();
    } catch {
      msg = `🌙 Bugünün özeti.\n\n✅ Tamamlanan: ${done.length} görev${moved.length ? '\n⏭ Yarına taşınan:\n' + moved.join('\n') : ''}\n\nİyi akşamlar.`;
    }

    notifyAll(msg);
    console.log('[CRON] 18:30 kapanış gönderildi.');
  } catch (e) {
    console.error('[CRON] 18:30 hatası:', e.message);
  }
}, { timezone: TZ });


// ─── DB Adapter (optional — zero-impact if absent) ───────────────────────────
const dbAdapter = (() => { try { return require('./db-adapter'); } catch { return null; } })();
if (dbAdapter) console.log('[SYS] DB-Adapter bağlandı — görevler web uygulamasıyla senkronize edilecek.');

// ─── Load saved schedules ────────────────────────────────────────────────────
registerSavedSchedules();

// ─── Start ────────────────────────────────────────────────────────────────────
console.log('[SYS] Sistem başlatılıyor...');

(async () => {
  if (dbAdapter) {
    try {
      const saved = await dbAdapter.getTodayTasks();
      if (saved && saved.length) {
        tasks = saved.map(t => ({ id: t.id, title: t.title, time: t.time, status: t.status || 'pending' }));
        const maxNum = saved.reduce((m, t) => {
          const n = parseInt(String(t.id).replace(/\D/g, ''));
          return isNaN(n) ? m : Math.max(m, n + 1);
        }, idCounter);
        idCounter = maxNum;
        console.log(`[SYS] ${tasks.length} görev web uygulamasından yüklendi.`);
      }
    } catch (e) {
      console.warn('[SYS] Görevler yüklenemedi:', e.message);
    }

    // Load conversation history
    try {
      const savedHistory = await dbAdapter.getConversationHistory();
      if (savedHistory && savedHistory.length) {
        conversationHistory.push(...sanitizeHistory(savedHistory));
        console.log(`[SYS] ${conversationHistory.length} mesaj geçmişi yüklendi.`);
      }
    } catch (e) {
      console.warn('[SYS] Konuşma geçmişi yüklenemedi:', e.message);
    }

    // Load routines and register their cron jobs
    try {
      const savedRoutines = await dbAdapter.getRoutines();
      if (savedRoutines && savedRoutines.length) {
        routines = savedRoutines;
        console.log(`[SYS] ${routines.length} rutin yüklendi.`);
        for (const r of routines) {
          if (r.time) {
            const s = { time: r.time, action: 'routine', text: r.text, description: r.text };
            registerSchedule(s);
          }
        }
      }
    } catch (e) {
      console.warn('[SYS] Rutinler yüklenemedi:', e.message);
    }

    // Load today's Google Calendar events into memory for context
    try {
      const calEvents = await dbAdapter.getCalendarEvents();
      if (Array.isArray(calEvents) && calEvents.length) {
        const mem = loadMemory();
        mem.calendar_today = calEvents.map(e => `${e.allDay ? 'Tüm gün' : e.start} — ${e.title}`);
        // Collect all unique attendee names for person context lookup
        const allAttendees = calEvents.flatMap(e => e.attendees || []);
        mem.calendar_attendees = [...new Set(allAttendees)];
        saveMemory(mem);
        console.log(`[SYS] ${calEvents.length} takvim etkinliği, ${mem.calendar_attendees.length} katılımcı yüklendi.`);
      }
    } catch (e) {
      console.warn('[SYS] Google Takvim yüklenemedi:', e.message);
    }
  }

  const mem        = loadMemory();
  const isFirstRun = conversationHistory.length === 0 && !mem.onboarding_done && mem.rules.length === 0;

  if (isFirstRun) {
    const onboardingMsg =
`Merhaba! 👋 Ben ${ASSISTANT_NAME}, sizin kişisel asistanınızım.

Sizi daha iyi tanımak ve en iyi şekilde yardımcı olmak için birkaç şey sormak istiyorum:

1️⃣ Ne iş yapıyorsunuz? (sektör, rol, günlük iş akışı)
2️⃣ Genellikle kaçta işe başlayıp kaçta bitiriyorsunuz?
3️⃣ En çok hangi konularda yardıma ihtiyaç duyuyorsunuz? (planlama, mesaj yazma, hatırlatma, araştırma...)
4️⃣ Haftalık düzenli programınız var mı? (toplantılar, spor, ders gibi)
5️⃣ Benden ne bekliyorsunuz — nasıl bir asistan olayım?

Bu bilgilerle size çok daha kişisel ve etkili yardım sunabilirim 😊`;
    send(onboardingMsg);
    // Mark onboarding as started so we don't repeat on next restart
    mem.onboarding_done = true;
    saveMemory(mem);
  } else {
    const pendingCount = tasks.filter(t => t.status === 'pending').length;
    const doneCount    = tasks.filter(t => t.status === 'done').length;
    const startupMsg = tasks.length
      ? `Merhaba ${USER_NAME}! 👋 Bugün ${doneCount} görev tamamlandı, ${pendingCount} bekliyor 💪\n\n${planText()}`
      : `Merhaba ${USER_NAME}! 👋 Ben ${ASSISTANT_NAME}, bugün size yardımcı olmak için buradayım 😊`;
    send(startupMsg);
  }

  // ─── WhatsApp init (optional) ──────────────────────────────────────────────
  const waEnabled = process.env.WA_ENABLED === 'true' || !!process.env.ALLOWED_WA_NUMBERS;
  if (waEnabled) {
    waModule = (() => { try { return require('./whatsapp'); } catch (e) { console.warn('[WA] whatsapp.js yüklenemedi:', e.message); return null; } })();
    if (waModule) {
      waModule.initWhatsApp({
        telegramBot:    bot,
        telegramChatId: CHAT_ID,

        // Group message → record student activity (no agent response)
        onGroupMessage: (phone, name, message, groupJid) => {
          studentsModule?.recordActivity(phone, name, message, groupJid);
        },

        // Text message from WhatsApp → run through agent
        onText: async (text, jid) => {
          lastMessageAt   = Date.now();
          await runAgentFromWA(text, jid);
        },

        // Image from WhatsApp → extract tasks, ask Telegram confirmation
        onImage: async (buffer, caption, jid) => {
          lastMessageAt   = Date.now();
          send('⏳ WhatsApp görseli analiz ediliyor...');
          const items = await extractTasksFromPhoto(buffer, caption).catch(() => []);
          if (!items.length) {
            send('❌ WhatsApp görselinde görev bulunamadı.');
            waModule?.sendWA(jid, '❌ Görselde görev bulunamadı.').catch(() => {});
            return;
          }
          const withTime    = items.filter(i => i.time && parseTime(i.time));
          const withoutTime = items.filter(i => !i.time || !parseTime(i.time));
          const added = [];
          for (const item of withTime) {
            const t = parseTime(item.time);
            if (t && !slotTaken(t)) added.push(addTask(item.title, t));
          }
          if (withoutTime.length) {
            const plan = await generateDailyPlan(withoutTime.map(i => i.title).join(', ')).catch(() => null);
            if (plan) for (const b of plan) {
              const t = parseTime(b.time);
              if (t && !slotTaken(t)) added.push(addTask(b.title, t));
            }
          }
          const reply = added.length
            ? '✅ WhatsApp görselinden eklendi:\n' + added.map(t => `${t.time} — ${t.title}`).join('\n')
            : '❌ Görev eklenemedi (slot dolu veya limit aşıldı).';
          send(reply);
          waModule?.sendWA(jid, reply).catch(() => {});
        },
      }).catch(e => console.error('[WA] initWhatsApp hatası:', e.message));
    }
  }
})();
