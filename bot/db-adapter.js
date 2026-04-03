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

const TODAY = () => new Date().toISOString().split('T')[0];

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

/** Returns today's non-done tasks. Returns a Promise. */
async function getTodayTasks() {
  try {
    const date = TODAY();
    const res  = await fetch(`${WEB_URL}/api/bot/tasks?date=${date}`, { headers: HEADERS });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    console.warn('[DB-Adapter] getTodayTasks error:', e.message);
    return [];
  }
}

/** Save a daily routine to the web app DB (fire-and-forget). */
function saveRoutine(text, time) {
  fetch(`${WEB_URL}/api/bot/routines`, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify({ text, time: time || null }),
  }).catch(e => console.warn('[DB-Adapter] saveRoutine error:', e.message));
}

module.exports = { syncTask, updateTaskStatus, deleteTask, getTodayTasks, saveRoutine };
