'use strict';

const fs   = require('fs');
const path = require('path');

const STUDENTS_FILE = path.join(__dirname, 'students.json');
const ACTIVITY_FILE = path.join(__dirname, 'student_activity.json');

// ─── Registry (who the students are) ─────────────────────────────────────────

function loadStudents() {
  try {
    if (fs.existsSync(STUDENTS_FILE))
      return JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
  } catch {}
  return [];
}

function saveStudents(list) {
  try { fs.writeFileSync(STUDENTS_FILE, JSON.stringify(list, null, 2)); } catch {}
}

function addStudent(name, phone, group = '') {
  const list       = loadStudents();
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) return { error: 'Geçersiz numara.' };
  if (list.find(s => s.phone === cleanPhone))
    return { error: `${cleanPhone} zaten kayıtlı.` };
  const student = {
    id:      `s${Date.now()}`,
    name,
    phone:   cleanPhone,
    group:   group || '',
    addedAt: new Date().toISOString().split('T')[0],
  };
  list.push(student);
  saveStudents(list);
  return student;
}

// Bulk add: [{name, phone, group?}] — skips duplicates, returns {added, skipped}
function addStudents(rows) {
  const list = loadStudents();
  let added = 0, skipped = 0;
  for (const row of rows) {
    const cleanPhone = String(row.phone || '').replace(/\D/g, '');
    if (!cleanPhone || list.find(s => s.phone === cleanPhone)) { skipped++; continue; }
    list.push({ id: `s${Date.now()}_${added}`, name: row.name, phone: cleanPhone, group: row.group || '', addedAt: new Date().toISOString().split('T')[0] });
    added++;
  }
  saveStudents(list);
  return { added, skipped };
}

function removeStudent(identifier) {
  let list   = loadStudents();
  const lower = String(identifier).toLowerCase();
  const clean = String(identifier).replace(/\D/g, '');
  const before = list.length;
  list = list.filter(s =>
    !s.name.toLowerCase().includes(lower) &&
    (clean.length < 5 || s.phone !== clean)
  );
  saveStudents(list);
  return before - list.length;
}

// ─── Activity (what they did recently) ───────────────────────────────────────

function loadActivity() {
  try {
    if (fs.existsSync(ACTIVITY_FILE))
      return JSON.parse(fs.readFileSync(ACTIVITY_FILE, 'utf8'));
  } catch {}
  return {};
}

function saveActivity(data) {
  try { fs.writeFileSync(ACTIVITY_FILE, JSON.stringify(data, null, 2)); } catch {}
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Record that a student sent a message.
 * @param {string} phone  — raw phone (digits only preferred)
 * @param {string} name   — display name from WhatsApp pushName
 * @param {string} message
 * @param {string} groupJid — group JID (ends with @g.us) or empty for DM
 */
function recordActivity(phone, name, message, groupJid = '') {
  const cleanPhone = String(phone).replace(/\D/g, '');
  if (!cleanPhone) return;

  const activity = loadActivity();
  const today    = todayISO();
  const existing = activity[cleanPhone] || {};

  // Keep rolling weekly count
  const weekAgo      = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  const lastDate     = existing.lastMessageDate || '';
  const wasThisWeek  = lastDate >= weekAgo;
  const wasToday     = lastDate === today;

  activity[cleanPhone] = {
    name:            name || existing.name || cleanPhone,
    group:           groupJid || existing.group || '',
    lastSeen:        new Date().toISOString(),
    lastMessage:     (message || '').slice(0, 200),
    lastMessageDate: today,
    messagesToday:   (wasToday ? (existing.messagesToday || 0) : 0) + 1,
    messagesThisWeek: (wasThisWeek ? (existing.messagesThisWeek || 0) : 0) + 1,
  };

  // Auto-update name in students.json if we have a better name
  if (name && name !== cleanPhone) {
    const list = loadStudents();
    const student = list.find(s => s.phone === cleanPhone);
    if (student && !student.name) {
      student.name = name;
      saveStudents(list);
    }
  }

  saveActivity(activity);
  console.log(`[STUDENTS] Aktivite: ${name || cleanPhone} — "${(message || '').slice(0, 40)}"`);
}

// ─── Reporting ────────────────────────────────────────────────────────────────

/**
 * Returns enriched student list sorted by days-silent descending.
 */
function getStudentReport() {
  const students = loadStudents();
  const activity = loadActivity();

  return students.map(s => {
    const act      = activity[s.phone] || {};
    const lastDate = act.lastMessageDate;
    const daysSilent = lastDate
      ? Math.max(0, Math.floor((Date.now() - new Date(lastDate + 'T00:00:00').getTime()) / 86400000))
      : 999;

    let flag = null;
    if (daysSilent >= 7)  flag = 'critical'; // 7+ gün
    else if (daysSilent >= 3) flag = 'warning';  // 3-6 gün
    else if (daysSilent >= 1) flag = 'watch';    // 1-2 gün

    return {
      ...s,
      lastSeen:         act.lastSeen        || null,
      lastMessage:      act.lastMessage     || null,
      lastMessageDate:  lastDate            || null,
      messagesToday:    act.messagesToday   || 0,
      messagesThisWeek: act.messagesThisWeek || 0,
      daysSilent,
      flag,
    };
  }).sort((a, b) => b.daysSilent - a.daysSilent);
}

/**
 * Compact summary for morning briefing context.
 */
function getMorningSummary() {
  const report = getStudentReport();
  if (!report.length) return null;

  const critical  = report.filter(s => s.flag === 'critical');  // 7+ gün
  const warning   = report.filter(s => s.flag === 'warning');   // 3-6 gün
  const watch     = report.filter(s => s.flag === 'watch');     // 1-2 gün
  const active    = report.filter(s => !s.flag);                // bugün/dün aktif
  const neverSeen = report.filter(s => s.daysSilent === 999);

  return { total: report.length, critical, warning, watch, active, neverSeen, report };
}

module.exports = {
  loadStudents,
  addStudent,
  addStudents,
  removeStudent,
  recordActivity,
  getStudentReport,
  getMorningSummary,
  loadActivity,
};
