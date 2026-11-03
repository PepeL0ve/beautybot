// lib/svc/hours.js — рабочие часы, время-оф, шаблоны расписания (spec §6).

import { db } from 'sdk';
import { and, eq, asc } from 'sdk/db';
import { workHours, timeOff, scheduleTemplates } from '../../schema.js';
import { WD_SHORT, addDays, localDate } from '../time.js';

export async function getWorkHours(masterId) {
  const rows = await db
    .select()
    .from(workHours)
    .where(eq(workHours.masterId, masterId))
    .orderBy(asc(workHours.weekday))
    .all();
  return rows;
}

// Установить интервал дня недели (создать или обновить).
export async function setWorkDay(masterId, weekday, { startMin, endMin, enabled }) {
  const existing = await db
    .select()
    .from(workHours)
    .where(and(eq(workHours.masterId, masterId), eq(workHours.weekday, weekday)))
    .get();
  const values = { startMin, endMin, enabled };
  if (existing) {
    return db.update(workHours).set(values)
      .where(and(eq(workHours.masterId, masterId), eq(workHours.weekday, weekday)))
      .returning().then((r) => r[0] || null);
  }
  const rows = await db.insert(workHours).values({ masterId, weekday, ...values }).returning();
  return rows[0];
}

export async function toggleWorkDay(masterId, weekday) {
  const row = await db
    .select()
    .from(workHours)
    .where(and(eq(workHours.masterId, masterId), eq(workHours.weekday, weekday)))
    .get();
  if (!row) {
    // Включение «пустого» дня: дефолт 10:00–19:00.
    return setWorkDay(masterId, weekday, { startMin: 600, endMin: 1140, enabled: true });
  }
  return setWorkDay(masterId, weekday, {
    startMin: row.startMin, endMin: row.endMin, enabled: !row.enabled,
  });
}

// --- Время-оф ---

export async function listTimeOff(masterId, fromDate, toDate) {
  const rows = await db
    .select()
    .from(timeOff)
    .where(eq(timeOff.masterId, masterId))
    .orderBy(asc(timeOff.date), asc(timeOff.startMin))
    .all();
  return rows.filter((r) => r.date >= fromDate && r.date <= toDate);
}

export async function addTimeOff(masterId, { date, startMin, endMin, kind, note }) {
  const rows = await db
    .insert(timeOff)
    .values({ masterId, date, startMin: startMin ?? null, endMin: endMin ?? null, kind, note: note || null })
    .returning();
  return rows[0];
}

export async function removeTimeOff(masterId, id) {
  await db
    .delete(timeOff)
    .where(and(eq(timeOff.masterId, masterId), eq(timeOff.id, id)))
    .run();
}

export function timeOffLabel(r) {
  const kindLabel = { break: '☕ Перерыв', dayoff: '🏖 Выходной', personal: '👤 Личное дело' }[r.kind] || r.kind;
  const time = r.startMin == null ? 'весь день' : `${fmtMin(r.startMin)}–${fmtMin(r.endMin)}`;
  return `${kindLabel} · ${time}${r.note ? ' · ' + r.note : ''}`;
}

function fmtMin(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// --- Шаблоны ---

export const PRESET_TEMPLATE = {
  name: 'Пн–Пт 10:00–19:00',
  payload: [0, 1, 2, 3, 4].map((weekday) => ({ weekday, startMin: 600, endMin: 1140, enabled: true }))
    .concat([5, 6].map((weekday) => ({ weekday, startMin: 600, endMin: 1140, enabled: false }))),
};

export async function listTemplates(masterId) {
  return db
    .select()
    .from(scheduleTemplates)
    .where(eq(scheduleTemplates.masterId, masterId))
    .orderBy(asc(scheduleTemplates.id))
    .all();
}

export async function saveCurrentAsTemplate(masterId, name) {
  const current = await getWorkHours(masterId);
  const payload = [0, 1, 2, 3, 4, 5, 6].map((weekday) => {
    const row = current.find((r) => r.weekday === weekday);
    return row
      ? { weekday, startMin: row.startMin, endMin: row.endMin, enabled: row.enabled }
      : { weekday, startMin: 600, endMin: 1140, enabled: false };
  });
  const rows = await db
    .insert(scheduleTemplates)
    .values({ masterId, name: String(name).slice(0, 60), payload })
    .returning();
  return rows[0];
}

// Применить шаблон ко ВСЕМ дням недели (переписывает work_hours).
export async function applyTemplate(masterId, templateId) {
  const tpl = await db
    .select()
    .from(scheduleTemplates)
    .where(and(eq(scheduleTemplates.masterId, masterId), eq(scheduleTemplates.id, templateId)))
    .get();
  if (!tpl) return false;
  for (const day of tpl.payload) {
    await setWorkDay(masterId, day.weekday, {
      startMin: day.startMin, endMin: day.endMin, enabled: !!day.enabled,
    });
  }
  return true;
}

// Создать шаблон из предустановки (если его ещё нет).
export async function ensurePresetTemplate(masterId) {
  const all = await listTemplates(masterId);
  if (all.some((t) => t.name === PRESET_TEMPLATE.name)) return;
  await db.insert(scheduleTemplates).values({
    masterId, name: PRESET_TEMPLATE.name, payload: PRESET_TEMPLATE.payload,
  }).run();
}

export function weekSummary(hours) {
  return [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const row = hours.find((r) => r.weekday === wd);
    const label = WD_SHORT[wd];
    if (!row || !row.enabled) return `${label} — выходной`;
    return `${label} — ${fmtMin(row.startMin)}–${fmtMin(row.endMin)}`;
  }).join('\n');
}

export function nextDays(n, tz, nowSec) {
  const today = localDate(tz, nowSec);
  return Array.from({ length: n }, (_, i) => addDays(today, i));
}