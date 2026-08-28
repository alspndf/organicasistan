'use strict';

/**
 * DB bridge — calls the web app's bot API instead of accessing SQLite directly.
 * Works both locally (http://localhost:3000) and on Railway.
 */

const WEB_URL = process.env.WEB_APP_URL || 'http://localhost:3000';
const SECRET  = process.env.BOT_SECRET  || 'organic-bot-internal';

const USER_ID = process.env.WEB_USER_ID || '';

const HEADERS = {
  'Content-Type': 'application/json',
  'x-bot-secret': SECRET,
  'x-bot-user-id': USER_ID,
};

const TZ = process.env.BOT_TIMEZONE || 'Europe/Istanbul';

// toISOString() is UTC — between 00:00 and 03:00 Istanbul time it still returns
// yesterday's date, which silently wrote tasks onto the wrong day.
const TODAY = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });

/** Upsert a task into the web app DB (fire-and-forget). */
function syncTask(task, date) {
  fetch(`${WEB_URL}/api/bot/tasks`, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ ...task, date: date || TODAY() }),
  }).catch(e => console.warn('[DB-Adapter] syncTask error:', e.message));
}

/** Update task status (fire-and-forget). */
function updateTaskStatus(taskId, status) {
  fetch(`${WEB_URL}/api/bot/tasks`, {
    method:  'PATCH',
    headers: HEADERS,
    body:    JSON.stringify({ id: taskId, status }),
  }).catch(e => console.warn('[DB-Adapter] updateTaskStatus error:', e.message));
}

/** Delete a task (fire-and-forget). */
function deleteTask(taskId) {
  fetch(`${WEB_URL}/api/bot/tasks?id=${encodeURIComponent(taskId)}`, {
    method:  'DELETE',
    headers: HEADERS,
  }).catch(e => console.warn('[DB-Adapter] deleteTask error:', e.message));
}

/** Returns all tasks for a given YYYY-MM-DD date. Returns a Promise. */
async function getTasksByDate(date) {
  try {
    const d   = date || TODAY();
    const res = await fetch(`${WEB_URL}/api/bot/tasks?date=${d}`, { headers: HEADERS });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[DB-Adapter] getTasksByDate error:', e.message);
    return [];
  }
}

/** Returns today's tasks. Returns a Promise. */
const getTodayTasks = () => getTasksByDate(TODAY());

/** Save a daily routine to the web app DB (fire-and-forget). */
function saveRoutine(text, time) {
  fetch(`${WEB_URL}/api/bot/routines`, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ text, time: time || null }),
  }).catch(e => console.warn('[DB-Adapter] saveRoutine error:', e.message));
}

/** Fetch all saved daily routines. Returns a Promise. */
async function getRoutines() {
  try {
    const res = await fetch(`${WEB_URL}/api/bot/routines`, { headers: HEADERS });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[DB-Adapter] getRoutines error:', e.message);
    return [];
  }
}

/** Load saved conversation history. Returns a Promise. */
async function getConversationHistory() {
  try {
    const res = await fetch(`${WEB_URL}/api/bot/history`, { headers: HEADERS });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[DB-Adapter] getConversationHistory error:', e.message);
    return [];
  }
}

/** Persist conversation history (fire-and-forget). */
function saveConversationHistory(messages) {
  fetch(`${WEB_URL}/api/bot/history`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify(messages),
  }).catch(e => console.warn('[DB-Adapter] saveConversationHistory error:', e.message));
}

/** Fetch Google Calendar events for a given date. Returns a Promise. */
async function getCalendarEvents(date) {
  try {
    const d   = date || TODAY();
    const res = await fetch(`${WEB_URL}/api/bot/calendar?date=${d}`, { headers: HEADERS });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[DB-Adapter] getCalendarEvents error:', e.message);
    return [];
  }
}

module.exports = {
  syncTask, updateTaskStatus, deleteTask, getTodayTasks, getTasksByDate,
  saveRoutine, getRoutines,
  getConversationHistory, saveConversationHistory,
  getCalendarEvents,
};
