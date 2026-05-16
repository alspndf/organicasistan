'use strict';
/**
 * WhatsApp integration via @whiskeysockets/baileys.
 *
 * Features:
 *  - QR code sent to Telegram on first connection
 *  - Session persisted in bot/wa_session/ (no re-QR on restart)
 *  - Text, voice (Groq transcription), image (task extraction) support
 *  - Only ALLOWED_WA_NUMBERS are processed (empty = allow all)
 *  - Auto-reconnect on drop; Telegram notification on status changes
 *  - Reports status to web app via /api/bot/wa-notify
 */

const path  = require('path');
const fs    = require('fs');
const https = require('https');

const SESSION_DIR = path.join(__dirname, 'wa_session');

// ─── Module state ─────────────────────────────────────────────────────────────
let _sock           = null;
let _reconnectTimer = null;
let waStatus = { connected: false, phone: '', qrPending: false };

// Injected at initWhatsApp() time
let _telegramBot     = null;
let _telegramChatId  = null;
let _onText          = null;  // async (text: string, jid: string) => void
let _onImage         = null;  // async (buffer: Buffer, caption: string, jid: string) => void
let _onGroupMessage  = null;  // (phone: string, name: string, text: string, groupJid: string) => void

// ─── Allow-list ───────────────────────────────────────────────────────────────
function isAllowed(jid) {
  const raw     = process.env.ALLOWED_WA_NUMBERS || '';
  const allowed = raw.split(',').map(n => n.trim().replace(/\D/g, '')).filter(Boolean);
  if (!allowed.length) return true; // no restriction → allow everyone
  const number = jid.split('@')[0].replace(/\D/g, '');
  return allowed.includes(number);
}

// ─── Report status to web app ─────────────────────────────────────────────────
function notifyWebStatus() {
  const webUrl    = process.env.WEB_APP_URL  || 'http://localhost:3000';
  const botSecret = process.env.BOT_SECRET   || 'organic-bot-internal';
  const userId    = process.env.WEB_USER_ID  || '';
  fetch(`${webUrl}/api/bot/wa-notify`, {
    method:  'POST',
    headers: {
      'Content-Type':   'application/json',
      'x-bot-secret':   botSecret,
      'x-bot-user-id':  userId,
    },
    body: JSON.stringify(waStatus),
  }).catch(() => {});
}

// ─── QR code → Telegram + Web ─────────────────────────────────────────────────
async function sendQRToTelegram(qrString) {
  try {
    const QRCode = require('qrcode');
    const buf    = await QRCode.toBuffer(qrString, { type: 'png', width: 350, margin: 2 });

    // Send to Telegram
    await _telegramBot?.sendPhoto(
      _telegramChatId,
      buf,
      { caption: '📱 *WhatsApp\'ı bağlamak için QR kodu okutun*\n\nWhatsApp → Bağlı Cihazlar → Cihaz Ekle' },
      { filename: 'whatsapp-qr.png', contentType: 'image/png' }
    );
    console.log('[WA] QR Telegram\'a gönderildi.');

    // Also send to web app so the settings page can display it
    const webUrl    = process.env.WEB_APP_URL || 'http://localhost:3000';
    const botSecret = process.env.BOT_SECRET  || 'organic-bot-internal';
    const userId    = process.env.WEB_USER_ID || '';
    const qrBase64  = buf.toString('base64');
    fetch(`${webUrl}/api/bot/wa-notify`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-bot-secret':  botSecret,
        'x-bot-user-id': userId,
      },
      body: JSON.stringify({ connected: false, phone: '', qrPending: true, qrCode: qrBase64 }),
    }).catch(() => {});
  } catch (e) {
    console.error('[WA] QR gönderme hatası:', e.message);
    _telegramBot?.sendMessage(_telegramChatId, `📱 WhatsApp QR hazır (terminal\'e bakın): hata: ${e.message}`);
  }
}

// ─── Groq: WA audio buffer → text ─────────────────────────────────────────────
async function transcribeWAAudio(buffer) {
  const GROQ_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_KEY) {
    console.warn('[WA] GROQ_API_KEY yok, ses transkript edilemiyor.');
    return null;
  }

  const boundary = '----WABoundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.ogg"\r\nContent-Type: audio/ogg\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\ntr\r\n`),
    Buffer.from(`--${boundary}--\r\n`),
  ]);

  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.groq.com',
      path:     '/openai/v1/audio/transcriptions',
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type':  `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()).text || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}

// ─── Silent logger (suppresses Baileys output) ────────────────────────────────
const SILENT_LOGGER = {
  level: 'silent',
  trace: () => {}, debug: () => {}, info: () => {},
  warn:  () => {}, error: () => {}, fatal: () => {},
  child() { return this; },
};

// ─── Baileys connection ───────────────────────────────────────────────────────
async function connectWA() {
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;

  // Dynamic import supports both CJS and ESM Baileys builds
  const baileys = await import('@whiskeysockets/baileys');
  const makeWASocket        = baileys.default;
  const useMultiFileAuthState = baileys.useMultiFileAuthState;
  const DisconnectReason    = baileys.DisconnectReason;
  const downloadMediaMessage = baileys.downloadMediaMessage;

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  _sock = makeWASocket({
    auth:               state,
    printQRInTerminal:  false,
    logger:             SILENT_LOGGER,
    browser:            ['Organic Assistant', 'Chrome', '1.0.0'],
    // Keep alive settings
    keepAliveIntervalMs: 30_000,
  });

  _sock.ev.on('creds.update', saveCreds);

  // ── Connection updates ──────────────────────────────────────────────────────
  _sock.ev.on('connection.update', async update => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      waStatus = { connected: false, phone: '', qrPending: true };
      notifyWebStatus();
      console.log('[WA] QR kodu hazır, Telegram\'a gönderiliyor...');
      await sendQRToTelegram(qr);
    }

    if (connection === 'open') {
      const rawId = _sock.user?.id || '';
      waStatus = { connected: true, phone: rawId.split(':')[0] || rawId, qrPending: false };
      notifyWebStatus();
      console.log(`[WA] Bağlandı: ${waStatus.phone}`);
      _telegramBot?.sendMessage(_telegramChatId, `✅ WhatsApp bağlandı! Numara: ${waStatus.phone}`);
    }

    if (connection === 'close') {
      const code      = (lastDisconnect?.error)?.output?.statusCode;
      const loggedOut = code === DisconnectReason?.loggedOut;
      waStatus = { connected: false, phone: waStatus.phone, qrPending: false };
      notifyWebStatus();
      console.log(`[WA] Bağlantı kapandı (kod: ${code}, loggedOut: ${loggedOut})`);

      if (loggedOut) {
        console.log('[WA] Oturum kapatıldı, session temizleniyor.');
        _telegramBot?.sendMessage(_telegramChatId, '🔴 WhatsApp oturumu kapandı. Ayarlar\'dan yeniden bağlanın.');
        try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
      } else {
        _telegramBot?.sendMessage(_telegramChatId, '⚠️ WhatsApp bağlantısı koptu, 8s sonra yeniden bağlanılıyor...');
        _reconnectTimer = setTimeout(connectWA, 8_000);
      }
    }
  });

  // ── Incoming messages ───────────────────────────────────────────────────────
  _sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      // Skip outgoing
      if (msg.key.fromMe) continue;

      const jid     = msg.key.remoteJid;
      if (!jid || jid === 'status@broadcast') continue;

      const content = msg.message;
      if (!content) continue;

      // ── Group message — track student activity, don't pass to agent ───────
      const isGroup = jid.endsWith('@g.us');
      if (isGroup) {
        const senderJid   = msg.key.participant || '';
        const senderPhone = senderJid.split('@')[0].replace(/\D/g, '');
        const pushName    = msg.pushName || '';
        const textBody    = content.conversation ?? content.extendedTextMessage?.text ?? '';
        if (senderPhone && _onGroupMessage) {
          _onGroupMessage(senderPhone, pushName, textBody, jid);
        }
        continue; // never pass group messages to the agent
      }

      // ── Direct message — apply allow-list then process normally ───────────
      if (!isAllowed(jid)) {
        console.log(`[WA] İzinsiz numara (${jid.split('@')[0]}) atlandı.`);
        continue;
      }

      // ── Text ──────────────────────────────────────────────────────────────
      const textBody = content.conversation ?? content.extendedTextMessage?.text;
      if (textBody) {
        console.log(`[WA] Metin (${jid.split('@')[0]}): ${textBody}`);
        _onText?.(textBody, jid).catch(e => console.error('[WA] onText hatası:', e.message));
        continue;
      }

      // ── Voice / Audio ─────────────────────────────────────────────────────
      if (content.audioMessage) {
        console.log(`[WA] Ses mesajı (${jid.split('@')[0]})`);
        try {
          const buf  = await downloadMediaMessage(msg, 'buffer', {});
          const text = await transcribeWAAudio(buf);
          if (text) {
            console.log(`[WA] Transkript: ${text}`);
            _telegramBot?.sendMessage(_telegramChatId, `🎙️ WhatsApp ses mesajı: "${text}"`);
            _onText?.(text, jid).catch(e => console.error('[WA] onText(ses) hatası:', e.message));
          } else {
            _sock.sendMessage(jid, { text: '⚠️ Ses mesajı çevrilemedi.' }).catch(() => {});
          }
        } catch (e) {
          console.error('[WA] Ses işleme hatası:', e.message);
        }
        continue;
      }

      // ── Image ─────────────────────────────────────────────────────────────
      if (content.imageMessage) {
        console.log(`[WA] Görsel (${jid.split('@')[0]})`);
        try {
          const buf     = await downloadMediaMessage(msg, 'buffer', {});
          const caption = content.imageMessage.caption || '';
          _onImage?.(buf, caption, jid).catch(e => console.error('[WA] onImage hatası:', e.message));
        } catch (e) {
          console.error('[WA] Görsel işleme hatası:', e.message);
        }
        continue;
      }
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize WhatsApp. Called once at bot startup if WA is enabled.
 *
 * @param {object} opts
 * @param {object}   opts.telegramBot      — node-telegram-bot-api instance
 * @param {string}   opts.telegramChatId   — owner's chat ID
 * @param {Function} opts.onText           — async (text, jid) handler
 * @param {Function} opts.onImage          — async (buffer, caption, jid) handler
 */
async function initWhatsApp({ telegramBot, telegramChatId, onText, onImage, onGroupMessage }) {
  _telegramBot    = telegramBot;
  _telegramChatId = telegramChatId;
  _onText         = onText;
  _onImage        = onImage;
  _onGroupMessage = onGroupMessage || null;

  console.log('[WA] Başlatılıyor (session:', SESSION_DIR, ')');
  try {
    await connectWA();
  } catch (e) {
    console.error('[WA] Başlatma hatası:', e.message);
    _telegramBot?.sendMessage(telegramChatId, `❌ WhatsApp başlatılamadı: ${e.message}`);
  }
}

/**
 * Send a text message to a WhatsApp number or JID.
 * @param {string} jid — phone number (905XXXXXXXXX) or JID (905XXXXXXXXX@s.whatsapp.net)
 * @param {string} text
 */
function sendWA(jid, text) {
  if (!_sock || !waStatus.connected) {
    return Promise.reject(new Error('WhatsApp bağlı değil.'));
  }
  const cleanJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;
  return _sock.sendMessage(cleanJid, { text });
}

/** Returns a snapshot of current WA connection status. */
function getWAStatus() {
  return { ...waStatus };
}

/** Disconnect WhatsApp, clear session, allow re-connect via reconnectWA(). */
async function disconnectWA() {
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
  try {
    if (_sock) {
      await _sock.logout().catch(() => {});
      _sock = null;
    }
  } catch {}
  try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
  waStatus = { connected: false, phone: '', qrPending: false };
  notifyWebStatus();
  console.log('[WA] Bağlantı kesildi ve oturum silindi.');
}

/** Reconnect (or connect for the first time) without re-initing the module. */
async function reconnectWA() {
  console.log('[WA] Yeniden bağlanılıyor...');
  await connectWA();
}

module.exports = { initWhatsApp, sendWA, getWAStatus, disconnectWA, reconnectWA };
