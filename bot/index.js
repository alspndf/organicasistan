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
const MODEL         = 'claude-opus-4-6';

if (!TOKEN || !CHAT_ID || !ANTHROPIC_KEY) {
  console.error('❌  TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID ve ANTHROPIC_API_KEY gerekli.');
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });
const bot       = new TelegramBot(TOKEN, { polling: true });

// ─── State ────────────────────────────────────────────────────────────────────
let tasks       = [];          // { id, title, time, status: 'pending'|'done' }
let idCounter   = 1;
const firedKeys = new Set();   // prevent double-firing
let pendingReschedule          = null;  // task.id waiting for a new time from user
let pendingDeleteIds           = [];    // task IDs awaiting delete confirmation
let pendingAnalysisReschedule  = null;  // [{title,time}] incomplete tasks awaiting tomorrow confirm
let lastMessageAt = Date.now(); // inactivity tracking
let inactivityFired = false;    // prevent repeated pings per silence window

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_TASKS   = 9999;
const TASK_MIN_M  = 30;   // minimum task block in minutes
const TASK_MAX_M  = 90;   // maximum task block in minutes
const PRE_REMIND  = 5;    // pre-reminder lead time in minutes

const DAY_KEYS    = ['pazar','pazartesi','salı','çarşamba','perşembe','cuma','cumartesi'];
const DAY_LABELS  = { 0:'Pazar',1:'Pazartesi',2:'Salı',3:'Çarşamba',4:'Perşembe',5:'Cuma',6:'Cumartesi' };

// ─── Memory ───────────────────────────────────────────────────────────────────
const MEMORY_FILE = path.join(__dirname, 'memory.json');

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

function todayKey() {
  const day = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' }).toLowerCase();
  return DAY_KEYS.find(k => day.startsWith(k)) || DAY_KEYS[new Date().getDay()];
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
  // Replace existing schedule with same action to avoid duplicates
  mem.schedules = mem.schedules.filter(s => s.action !== schedule.action);
  mem.schedules.push(schedule);
  saveMemory(mem);
}

function loadSchedules() {
  const mem = loadMemory();
  return mem.schedules || [];
}

// ─── Time utilities (pure math — not NLP) ────────────────────────────────────
const pad    = n => String(n).padStart(2, '0');
const nowHH  = () => new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).replace('.', ':');

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

function addTask(title, time) {
  const task = { id: `t${idCounter++}`, title, time, status: 'pending' };
  tasks.push(task);
  console.log(`[ADD] ${task.time} — ${task.title}`);
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
  return '📋 Bugünün planı:\n\n' +
    sortedTasks()
      .map((t, i) => `${i + 1}. ${t.status === 'done' ? '✅' : '⏳'} ${t.time} — ${t.title}`)
      .join('\n');
}

// ─── Telegram helpers ─────────────────────────────────────────────────────────
const send = text => bot.sendMessage(CHAT_ID, text);

function sendButtons(text, buttons) {
  return bot.sendMessage(CHAT_ID, text, {
    reply_markup: {
      inline_keyboard: [
        buttons.map(b => ({ text: b.label, callback_data: b.data }))
      ]
    }
  });
}

function fireTask(task) {
  return sendButtons(
    `⏰ Alp Bey, sıradaki göreviniz!\n\n📌 ${task.title}\n\nTamamladınız mı?`,
    [
      { label: '✅ Yaptım',   data: `DONE:${task.id}` },
      { label: '❌ Yapmadım', data: `NOTDONE:${task.id}` },
    ]
  );
}

// ─── Agent: conversation history ─────────────────────────────────────────────
const conversationHistory = [];
const MAX_HISTORY = 20;

function buildAgentSystem() {
  const current  = nowHH();
  const dayName  = DAY_LABELS[new Date().getDay()] || '';
  const mem      = loadMemory();
  const dayItems = mem.weekly_schedule[todayKey()] || [];
  const taskList = tasks.length
    ? sortedTasks().map((t, i) => `${i + 1}. [${t.status}] ${t.time} — ${t.title}`).join('\n')
    : 'Görev yok.';
  const pending  = pendingTasks().length;

  let sys = `Sen Yeliz'sin — Alp Bey'in kişisel asistanı. Samimi, zeki ve proaktifsin.

## Şu Anki Durum
Saat: ${current}
Gün: ${dayName}
Bekleyen görev: ${pending}/${MAX_TASKS}
${pendingReschedule ? `Erteleme bekleniyor: görev ID ${pendingReschedule}` : ''}

## Bugünkü Görevler
${taskList}`;

  if (dayItems.length) {
    sys += `\n\n## Bugün için Hafıza (${dayName})\n${dayItems.join(', ')}`;
  }
  if (mem.rules.length) {
    sys += `\n\n## Alışkanlıklar / Kurallar\n${mem.rules.join('\n')}`;
  }

  sys += `\n\n## Davranış Kuralları
- Araçları kullanarak görevleri gerçek olarak yönet, sadece söz verme
- Türkçe konuş, doğal ve samimi ol
- Konuşma geçmişini hatırla ve bağlamı kullan
- Proaktif ol: günün durumuna göre öneriler sun
- Görevi silmeden önce onay iste (delete_tasks confirmed:false ile)
- Bir görevi birden fazla şekilde tanımla: saat, numara veya anahtar kelime
- Alp Bey'e saygılı ve motive edici ol`;

  return sys;
}

const AGENT_TOOLS = [
  {
    name: 'add_task',
    description: 'Yeni görev ekle. Zaman çakışması veya limit aşımı varsa bildir.',
    input_schema: {
      type: 'object',
      properties: {
        time:  { type: 'string', description: 'HH:MM formatında saat' },
        title: { type: 'string', description: 'Görev başlığı' },
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
    description: 'Kullanıcı hakkında bir şeyi öğren ve hafızaya kaydet (haftalık program, alışkanlık, kural).',
    input_schema: {
      type: 'object',
      properties: {
        type:  { type: 'string', enum: ['weekly_schedule', 'rule'], description: 'Hafıza türü' },
        day:   { type: 'string', description: 'Gün (sadece weekly_schedule için): pazar|pazartesi|salı|çarşamba|perşembe|cuma|cumartesi' },
        value: { type: 'string', description: 'Kaydedilecek bilgi' },
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
    description: 'Günlük rutin veya alışkanlık kaydet. "Her gün sabah X\'te Y yap", "hergün yapılacaklar" gibi taleplerde kullan. Web uygulamasına kaydeder, kalıcıdır.',
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
  const dayName    = DAY_LABELS[new Date().getDay()] || '';
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
  const done    = tasks.filter(t => t.status === 'done');
  const pending = tasks.filter(t => t.status === 'pending');
  const total   = tasks.length;

  let summary = '';
  try {
    const r = await anthropic.messages.create({
      model: MODEL, max_tokens: 512,
      system: 'Sen Yeliz, Alp Bey\'in asistanısın. Kısa, samimi ve motive edici bir günlük analiz yaz.',
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
      ? `Alp Bey, bugün ${done.length} görev tamamladınız 🎉`
      : 'Alp Bey, bugün görev tamamlanmadı.';
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
  }, { timezone: 'Europe/Istanbul' });

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
    if (tasks.length >= MAX_TASKS) break;
    added.push(addTask(item.title, t));
  }

  // Items without a time → plan them
  if (withoutTime.length && tasks.length < MAX_TASKS) {
    const plan = await generateDailyPlan(withoutTime.map(i => i.title).join(', '));
    if (plan && plan.length) {
      for (const b of plan) {
        const t = parseTime(b.time);
        if (!t || slotTaken(t) || tasks.length >= MAX_TASKS) continue;
        added.push(addTask(b.title, t));
      }
    }
  }

  if (!added.length) { send('❌ Görev eklenemedi (slot dolu veya limit aşıldı).'); return; }
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
      if (tasks.filter(x => x.status === 'pending').length >= MAX_TASKS)
        return `❌ Maksimum ${MAX_TASKS} görev limitine ulaşıldı.`;
      if (slotTaken(t)) return `❌ ${t} saatinde zaten görev var.`;
      const task = addTask(input.title, t);
      return `✅ Eklendi: ${task.time} — ${task.title}`;
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
      return `✅ Tamamlandı: ${task.time} — ${task.title}`;
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
      return `✅ Taşındı: ${task.time} — ${task.title}`;
    }

    case 'create_daily_plan': {
      if (pendingTasks().length >= MAX_TASKS)
        return `❌ Plan dolu (${MAX_TASKS} görev). Önce mevcut görevleri tamamlayalım.`;
      const blocks = await generateDailyPlan(input.description);
      if (!blocks || !blocks.length) return '❌ Plan oluşturulamadı.';
      const added = [];
      for (const b of blocks) {
        const t = parseTime(b.time);
        if (!t || slotTaken(t) || tasks.length >= MAX_TASKS) continue;
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
      dbAdapter?.saveRoutine(routineText, routineTime);
      return `🔁 Günlük rutin kaydedildi: "${routineText}"${routineTime ? ` (${routineTime})` : ''} — Web uygulamasında Günlük Rutinler bölümünde görünür.`;
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
        const res  = await fetch(`${webUrl}/api/email/bot-analyze`, {
          method: 'POST',
          headers: { 'x-bot-secret': botSecret },
        });
        const data = await res.json();
        if (!res.ok) return `❌ ${data.error || 'E-postalar alınamadı.'}`;

        const { summary, actionItems, emailCount } = data;
        let result = `${emailCount} e-posta analiz edildi.\n`;
        if (summary) result += `Özet: ${summary}\n`;
        if (actionItems?.length) {
          result += `\nAksiyon öğeleri (${actionItems.length}):\n`;
          actionItems.forEach((item, i) => {
            result += `${i + 1}. [${item.type}] ${item.title}`;
            if (item.time) result += ` — ${item.time}`;
            if (item.from) result += ` (${item.from})`;
            result += '\n';
          });
        } else {
          result += 'Bugün için aksiyon gerektiren e-posta yok.';
        }
        return result;
      } catch (e) {
        return `❌ E-posta analizi başarısız: ${e.message}`;
      }
    }

    default:
      return `❌ Bilinmeyen araç: ${name}`;
  }
}

// ─── Agent: main loop ─────────────────────────────────────────────────────────
async function runAgent(userText) {
  conversationHistory.push({ role: 'user', content: userText });
  while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();

  const messages = [...conversationHistory];

  for (let round = 0; round < 8; round++) {
    let response;
    try {
      response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: buildAgentSystem(),
        tools: AGENT_TOOLS,
        messages,
      });
    } catch (e) {
      console.error('[AGENT] Claude hatası:', e.message);
      send('Üzgünüm Alp Bey, bir hata oluştu. Tekrar dener misiniz? 🙏');
      return;
    }

    const toolUses = response.content.filter(c => c.type === 'tool_use');

    if (response.stop_reason === 'end_turn' || !toolUses.length) {
      const finalText = response.content.filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
      if (finalText) {
        send(finalText);
        conversationHistory.push({ role: 'assistant', content: response.content });
        while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
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
    while (conversationHistory.length > MAX_HISTORY) conversationHistory.shift();
  }

  send('Üzgünüm Alp Bey, işlem tamamlanamadı. Tekrar dener misiniz?');
}

// ─── Scheduler (30s) ─────────────────────────────────────────────────────────
setInterval(() => {
  const now = nowHH();

  for (const task of tasks.filter(t => t.status === 'pending')) {
    // Pre-reminder
    const preKey = `pre:${task.id}:${task.time}`;
    if (!firedKeys.has(preKey) && now === addMins(task.time, -PRE_REMIND)) {
      firedKeys.add(preKey);
      send(`⏳ Alp Bey, 5 dakika sonra: ${task.title} 🔔`);
      console.log(`[PRE] ${task.title}`);
    }

    // Task fire
    const fireKey = `fire:${task.id}:${task.time}`;
    if (!firedKeys.has(fireKey) && now === task.time) {
      firedKeys.add(fireKey);
      console.log(`[FIRE] ${task.title} (${task.time})`);
      fireTask(task);
    }
  }
}, 30_000);

// ─── Callback handler ─────────────────────────────────────────────────────────
bot.on('callback_query', async query => {
  await bot.answerCallbackQuery(query.id);
  const data = query.data;

  if (data.startsWith('DONE:')) {
    const task = tasks.find(t => t.id === data.slice(5));
    if (task) {
      task.status = 'done';
      pendingReschedule = null;
      dbAdapter?.updateTaskStatus(task.id, 'done');
      send(`✅ Süper Alp Bey, aferin! 🎉\n${task.title} tamamlandı.`);
      console.log(`[DONE] ${task.title}`);
    }
    return;
  }

  if (data.startsWith('NOTDONE:')) {
    const task = tasks.find(t => t.id === data.slice(8));
    if (task) {
      pendingReschedule = task.id;
      send('Sorun değil Alp Bey 😊 Kaça taşıyalım?');
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
  inactivityFired = false;
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
  inactivityFired = false;

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
      send('Tamam Alp Bey, eklemedim. İyi geceler! 🌙');
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
      send('🗑 Silindi Alp Bey:\n' + deleted.map(t => `• ${t.time} — ${t.title}`).join('\n'));
      return;
    } else if (/^(hayır|hayir|no|vazgeç|vazgec|iptal)$/.test(lower)) {
      pendingDeleteIds = [];
      send('✅ Tamam Alp Bey, iptal edilmedi.');
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
    send('Üzgünüm Alp Bey, bir hata oluştu. Tekrar dener misiniz? 🙏');
  }
});

// ─── Global error guards (prevent silent crashes) ─────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UNCAUGHT] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT] uncaughtException:', err.message);
});

// ─── Cron: 09:00 — daily plan ─────────────────────────────────────────────────
cron.schedule('0 9 * * *', () => {
  const dayName  = DAY_LABELS[new Date().getDay()] || '';
  const mem      = loadMemory();
  const dayItems = mem.weekly_schedule[todayKey()] || [];
  const pending  = pendingTasks();

  const lines = [`📅 ${dayName} günün planı:`];
  if (dayItems.length) lines.push(`\nHafıza: ${dayItems.join(', ')}`);

  if (!pending.length) {
    lines.push('\nGörev yok.');
  } else {
    lines.push('');
    pending.forEach(t => lines.push(`⏳ ${t.time} — ${t.title}`));
  }
  send(lines.join('\n'));
  console.log('[CRON] 09:00 plan gönderildi.');
}, { timezone: 'Europe/Istanbul' });

// ─── Cron: 11:00 — email summary ─────────────────────────────────────────────
cron.schedule('0 11 * * *', () => {
  send(
    '📧 E-posta özeti:\n\n' +
    '🔴 Önemli:\n' +
    '  • Proje teslim tarihi (ekip@sirket.com)\n' +
    '  • Hedef takibi (yonetici@sirket.com)\n\n' +
    '🟡 Orta:\n' +
    '  • Haftalık bülten (bulten@tech.com)\n\n' +
    'Göreve dönüştürmek için:\n"15:00 e-posta yanıtları"'
  );
  console.log('[CRON] 11:00 e-posta özeti gönderildi.');
}, { timezone: 'Europe/Istanbul' });

// ─── Inactivity check (every 10 min, fires after 90 min silence) ─────────────
const INACTIVITY_MS = 90 * 60 * 1000; // 90 minutes

const INACTIVITY_MESSAGES = [
  'Alp Bey, bir süredir sessizsiniz 🤔 Her şey yolunda mı? Görevlerde yardımcı olayım mı?',
  'Alp Bey, uzun süredir haber yok 😊 Devam eden görevleriniz var, nasıl gidiyor?',
  'Alp Bey? 🌸 Merak ettim, bir şeye ihtiyacınız var mı?',
  'Alp Bey, görevler sizi bekliyor 📋 Hazır olduğunuzda buradayım!',
];

setInterval(() => {
  if (!inactivityFired && Date.now() - lastMessageAt >= INACTIVITY_MS) {
    inactivityFired = true;
    const msg = INACTIVITY_MESSAGES[Math.floor(Math.random() * INACTIVITY_MESSAGES.length)];
    send(msg);
    console.log('[INACTIVITY] Uyarı gönderildi.');
  }
}, 10 * 60 * 1000); // check every 10 minutes

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
  }

  const startupMsg = tasks.length
    ? `Merhaba Alp Bey! 👋 Bugün ${tasks.length} göreviniz var, devam edelim 💪\n\n${planText()}`
    : `Merhaba Alp Bey! 👋 Ben Yeliz, bugün size yardımcı olmak için buradayım 😊\n\nGörev eklemek için: "14:00 toplantı"\nGünlük plan için gününüzü anlatın, ben düzenlerim!`;
  send(startupMsg);
})();
