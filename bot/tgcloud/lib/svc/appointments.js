// lib/svc/appointments.js — записи: создание, перенос, статусы, виды (spec §8).

import { db } from 'sdk';
import { and, eq, gt, lt, gte, inArray, asc } from 'sdk/db';
import { appointments, services, clients } from '../../schema.js';
import { zonedToEpoch, localDate, addDays, localMin, minToHHMM } from '../time.js';
import { planAppointmentReminders, dropAppointmentReminders, planPendingStale } from './reminders.js';
import { slotsForDate } from './schedule.js';

const ACTIVE = ['pending', 'confirmed', 'completed'];

// Пересекается ли интервал с активной записью мастера (T5).
export async function hasConflict(masterId, startsAt, endsAt, { excludeId = null, stickyMin = 0 } = {}) {
  const pad = Math.max(0, stickyMin | 0) * 60;
  const rows = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.masterId, masterId),
        inArray(appointments.status, ACTIVE),
        lt(appointments.startsAt, endsAt + pad),
        gt(appointments.endsAt, startsAt - pad),
      ),
    )
    .all();
  return rows.filter((r) => r.id !== excludeId);
}

export async function createAppointment(master, data, nowSec) {
  const { clientId, serviceId, dateStr, startMin, priceCents, note, status, source } = data;
  const tz = master.timezone;

  let durationMin = data.durationMin;
  let price = priceCents;
  if (serviceId) {
    const svc = await db
      .select()
      .from(services)
      .where(and(eq(services.masterId, master.id), eq(services.id, serviceId)))
      .get();
    if (!svc) return { ok: false, reason: 'NO_SERVICE' };
    durationMin = svc.durationMin;
    if (price == null) price = svc.priceCents;
  }
  if (!durationMin) return { ok: false, reason: 'NO_DURATION' };

  const startsAt = zonedToEpoch(tz, dateStr, startMin);
  const endsAt = startsAt + durationMin * 60;

  const conflicts = await hasConflict(master.id, startsAt, endsAt, {
    stickyMin: master.settings?.sticky_min ?? 0,
  });
  if (conflicts.length) return { ok: false, reason: 'CONFLICT' };

  const rows = await db
    .insert(appointments)
    .values({
      masterId: master.id,
      clientId,
      serviceId: serviceId || null,
      startsAt,
      endsAt,
      status: status || 'confirmed',
      priceCents: price || 0,
      prepaid: false,
      note: note || null,
      source: source || 'master',
    })
    .returning();

  const ap = rows[0];
  // Планируем напоминания о записи (spec §13).
  try {
    await planAppointmentReminders(ap, master, nowSec);
    if (ap.status === 'pending') await planPendingStale(ap, master, nowSec);
  } catch (e) { console.warn('plan reminders failed', e); }
  return { ok: true, appointment: ap };
}

export async function getAppointment(masterId, id) {
  return db
    .select()
    .from(appointments)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .get();
}

export async function setStatus(masterId, id, status, nowSec) {
  const ap = await getAppointment(masterId, id);
  if (!ap) return { ok: false, reason: 'NOT_FOUND' };
  const patch = { status };
  if (status === 'canceled') patch.canceledAt = new Date();
  await db
    .update(appointments)
    .set(patch)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .run();
  // Отмена/неявка — напоминания больше не нужны (spec §13).
  if (status === 'canceled' || status === 'no_show') {
    try { await dropAppointmentReminders(id); } catch (e) { console.warn('drop reminders failed', e); }
  }
  return { ok: true, appointment: { ...ap, ...patch } };
}

export async function togglePrepaid(masterId, id) {
  const ap = await getAppointment(masterId, id);
  if (!ap) return null;
  await db
    .update(appointments)
    .set({ prepaid: !ap.prepaid })
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .run();
  return { ...ap, prepaid: !ap.prepaid };
}

export async function setPrice(masterId, id, priceCents) {
  await db
    .update(appointments)
    .set({ priceCents })
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .run();
  return getAppointment(masterId, id);
}

export async function setNote(masterId, id, note) {
  await db
    .update(appointments)
    .set({ note: note ? String(note).slice(0, 300) : null })
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .run();
  return getAppointment(masterId, id);
}

// Перенос: проверяем конфликт, исключая саму запись.
export async function moveAppointment(master, id, dateStr, startMin, nowSec) {
  const ap = await getAppointment(master.id, id);
  if (!ap) return { ok: false, reason: 'NOT_FOUND' };
  const startsAt = zonedToEpoch(master.timezone, dateStr, startMin);
  const endsAt = startsAt + (ap.endsAt - ap.startsAt);

  const conflicts = await hasConflict(master.id, startsAt, endsAt, {
    excludeId: id,
    stickyMin: master.settings?.sticky_min ?? 0,
  });
  if (conflicts.length) return { ok: false, reason: 'CONFLICT' };

  await db
    .update(appointments)
    .set({ startsAt, endsAt })
    .where(and(eq(appointments.masterId, master.id), eq(appointments.id, id)))
    .run();
  // Перепланируем напоминания на новое время.
  try { await planAppointmentReminders({ ...ap, startsAt, endsAt }, master, nowSec); } catch (e) { console.warn('replan reminders failed', e); }
  return { ok: true, appointment: { ...ap, startsAt, endsAt } };
}

// Полное удаление записи.
export async function deleteAppointment(masterId, id) {
  await db
    .delete(appointments)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.id, id)))
    .run();
}

// Записи локального дня (включая отменённые — для истории, но виды их помечают).
export async function dayAppointments(masterId, tz, dateStr) {
  const dayStart = zonedToEpoch(tz, dateStr, 0);
  const dayEnd = zonedToEpoch(tz, addDays(dateStr, 1), 0);
  const rows = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.masterId, masterId),
        gte(appointments.startsAt, dayStart),
        lt(appointments.startsAt, dayEnd),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .all();
  return rows;
}

// Записи диапазона дат (для недельного вида).
export async function rangeAppointments(masterId, tz, fromDate, toDate) {
  const from = zonedToEpoch(tz, fromDate, 0);
  const to = zonedToEpoch(tz, addDays(toDate, 1), 0);
  return db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.masterId, masterId),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .all();
}

// Обогащение записей именами клиента и услуги (join в коде — FK отключены).
export async function enrich(masterId, rows) {
  if (!rows.length) return [];
  const clientRows = await db.select().from(clients).where(eq(clients.masterId, masterId)).all();
  const serviceRows = await db.select().from(services).where(eq(services.masterId, masterId)).all();
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));
  const serviceMap = new Map(serviceRows.map((s) => [s.id, s]));
  return rows.map((a) => ({
    ...a,
    client: clientMap.get(a.clientId) || null,
    service: a.serviceId ? serviceMap.get(a.serviceId) || null : null,
  }));
}

export const STATUS_LABEL = {
  pending: '⏳ Ждёт подтверждения',
  confirmed: '✅ Подтверждена',
  completed: '✔️ Завершена',
  canceled: '❌ Отменена',
  no_show: '🚫 Неявка',
};

export function statusEmoji(s) {
  return { pending: '⏳', confirmed: '✅', completed: '✔️', canceled: '❌', no_show: '🚫' }[s] || '•';
}

export function apTime(ap, tz) {
  return minToHHMM(localMin(tz, ap.startsAt));
}

export function apDate(ap, tz) {
  return localDate(tz, ap.startsAt);
}

// Свободные слоты для переноса/создания: под длительность услуги.
export async function slotsForAppointment(master, ap, dateStr, nowSec) {
  const durationMin = Math.round((ap.endsAt - ap.startsAt) / 60);
  return slotsForDate(master, dateStr, durationMin, nowSec);
}