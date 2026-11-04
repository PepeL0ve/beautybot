// lib/svc/booking.js — клиентская сторона онлайн-записи (spec §10–§12):
// визитка, слоты, заявка, отмена, отзывы, лист ожидания.

import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import {
  appointments, clients, services, waitingList, reviews, masters,
} from '../../schema.js';
import { findOrCreateClientByTg } from './clients.js';
import { slotsForDate } from './schedule.js';
import { zonedToEpoch, localDate, addDays } from '../time.js';

// ---------- Доступ клиента ----------

// Клиент этого мастера по Telegram ID (null, если ещё не записывался).
export async function clientOfMaster(master, from) {
  const rows = await db.select().from(clients)
    .where(and(eq(clients.masterId, master.id), eq(clients.tgUserId, from.id)))
    .all();
  return rows[0] || null;
}

// Можно ли клиенту записываться (spec §10: ЧС и only_existing).
export function bookingBlockReason(master, client) {
  if (client?.blacklisted) return 'BLACKLIST';
  if (master.settings?.only_existing && !client) return 'ONLY_EXISTING';
  return null;
}

// Визитка: популярные услуги + активные.
export async function servicesForCard(master) {
  const rows = await db.select().from(services)
    .where(and(eq(services.masterId, master.id), eq(services.active, true)))
    .all();
  const popular = rows.filter((s) => s.isPopular);
  return { all: rows, popular };
}

// Даты, доступные для записи: следующие book_days_ahead дней, где есть окна.
export async function availableDates(master, durationMin, nowSec) {
  const days = master.settings?.book_days_ahead ?? 14;
  const today = localDate(master.timezone, nowSec);
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const slots = await slotsForDate(master, date, durationMin, nowSec);
    if (slots.length) out.push({ date, count: slots.length });
  }
  return out;
}

// ---------- Создание заявки ----------

export async function book(master, from, { serviceId, dateStr, startMin }, nowSec) {
  const svc = await db.select().from(services)
    .where(and(eq(services.masterId, master.id), eq(services.id, serviceId)))
    .get();
  if (!svc || !svc.active) return { ok: false, reason: 'NO_SERVICE' };

  let client = await clientOfMaster(master, from);
  const block = bookingBlockReason(master, client);
  if (block) return { ok: false, reason: block };

  // Слот должен быть реально свободен (защита от гонок и устаревших клавиатур).
  const slots = await slotsForDate(master, dateStr, svc.durationMin, nowSec);
  if (!slots.some((s) => s.min === startMin)) return { ok: false, reason: 'SLOT_TAKEN' };

  if (!client) client = await findOrCreateClientByTg(master.id, from);
  else await touchClientContact(master, client, from);

  const startsAt = zonedToEpoch(master.timezone, dateStr, startMin);
  const autoConfirm = !!master.settings?.auto_confirm;

  const rows = await db.insert(appointments).values({
    masterId: master.id,
    clientId: client.id,
    serviceId: svc.id,
    startsAt,
    endsAt: startsAt + svc.durationMin * 60,
    status: autoConfirm ? 'confirmed' : 'pending',
    priceCents: svc.priceCents,
    prepaid: false,
    note: null,
    source: 'self',
  }).returning();

  // Заявка клиента закрывает его ожидание.
  await closeWaitingList(master.id, client.id);

  return { ok: true, appointment: rows[0], client, service: svc, autoConfirm };
}

// Обновить контактные данные клиента из Telegram (имя/username), не затирая ручные.
async function touchClientContact(master, client, from) {
  const patch = {};
  const tgName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  if (tgName && client.displayName !== tgName && !client.phone) patch.displayName = tgName;
  if (from.username && client.username !== from.username) patch.username = from.username;
  if (!client.tgChatId) patch.tgChatId = from.id;
  if (Object.keys(patch).length) {
    await db.update(clients).set(patch)
      .where(and(eq(clients.masterId, master.id), eq(clients.id, client.id))).run();
  }
}

// ---------- Мои записи ----------

export async function myAppointments(master, clientId, nowSec) {
  if (!clientId) return [];
  const rows = await db.select().from(appointments)
    .where(and(eq(appointments.masterId, master.id), eq(appointments.clientId, clientId)))
    .all();
  const svcRows = await db.select().from(services).where(eq(services.masterId, master.id)).all();
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));

  const enriched = rows.map((a) => ({
    ...a,
    serviceName: a.serviceId ? svcMap.get(a.serviceId)?.name || null : null,
    dateStr: localDate(master.timezone, a.startsAt),
  }));

  const upcoming = enriched
    .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && a.startsAt >= nowSec)
    .sort((a, b) => a.startsAt - b.startsAt);
  const past = enriched
    .filter((a) => !upcoming.some((u) => u.id === a.id))
    .sort((a, b) => b.startsAt - a.startsAt)
    .slice(0, 10);
  return { upcoming, past };
}

// Завершённые записи без отзыва — можно оценить.
export async function reviewable(master, clientId) {
  if (!clientId) return [];
  const rows = await db.select().from(appointments)
    .where(and(eq(appointments.masterId, master.id), eq(appointments.clientId, clientId)))
    .all();
  const completed = rows.filter((a) => a.status === 'completed');
  if (!completed.length) return [];
  const reviewRows = await db.select().from(reviews)
    .where(and(eq(reviews.masterId, master.id), eq(reviews.clientId, clientId)))
    .all();
  const reviewed = new Set(reviewRows.map((r) => r.appointmentId));
  const svcRows = await db.select().from(services).where(eq(services.masterId, master.id)).all();
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));
  return completed
    .filter((a) => !reviewed.has(a.id))
    .sort((a, b) => b.startsAt - a.startsAt)
    .slice(0, 5)
    .map((a) => ({
      ...a,
      serviceName: a.serviceId ? svcMap.get(a.serviceId)?.name || null : null,
      dateStr: localDate(master.timezone, a.startsAt),
    }));
}

// ---------- Отмена клиентом ----------

export async function cancelByClient(master, apId, clientId) {
  const ap = await db.select().from(appointments)
    .where(and(eq(appointments.masterId, master.id), eq(appointments.id, apId)))
    .get();
  if (!ap || ap.clientId !== clientId) return { ok: false, reason: 'NOT_FOUND' };
  if (ap.status !== 'pending' && ap.status !== 'confirmed') return { ok: false, reason: 'NOT_ACTIVE' };

  await db.update(appointments)
    .set({ status: 'canceled', canceledAt: new Date() })
    .where(and(eq(appointments.masterId, master.id), eq(appointments.id, apId)))
    .run();
  return { ok: true, appointment: ap };
}

// ---------- Отзывы ----------

export async function submitReview(master, apId, clientId, rating, text) {
  if (rating < 1 || rating > 5) return { ok: false, reason: 'BAD_RATING' };
  const ap = await db.select().from(appointments)
    .where(and(eq(appointments.masterId, master.id), eq(appointments.id, apId)))
    .get();
  if (!ap || ap.clientId !== clientId) return { ok: false, reason: 'NOT_FOUND' };
  if (ap.status !== 'completed') return { ok: false, reason: 'NOT_COMPLETED' };

  const existing = await db.select().from(reviews)
    .where(eq(reviews.appointmentId, apId)).get();
  if (existing) return { ok: false, reason: 'ALREADY' };

  const rows = await db.insert(reviews).values({
    masterId: master.id,
    appointmentId: apId,
    clientId,
    rating,
    text: text ? String(text).slice(0, 500) : null,
  }).returning();
  return { ok: true, review: rows[0] };
}

// ---------- Лист ожидания ----------

export async function activeWaitlistEntry(masterId, clientId) {
  const rows = await db.select().from(waitingList)
    .where(and(eq(waitingList.masterId, masterId), eq(waitingList.clientId, clientId)))
    .all();
  return rows.find((r) => r.status === 'active' || r.status === 'notified') || null;
}

export async function addToWaitlist(master, clientId, { serviceId, dateFrom, dateTo }) {
  const existing = await activeWaitlistEntry(master.id, clientId);
  if (existing) return { ok: false, reason: 'ALREADY' };
  const rows = await db.insert(waitingList).values({
    masterId: master.id,
    clientId,
    serviceId: serviceId || null,
    dateFrom,
    dateTo,
    status: 'active',
  }).returning();
  return { ok: true, entry: rows[0] };
}

export async function removeFromWaitlist(masterId, clientId) {
  await db.delete(waitingList)
    .where(and(eq(waitingList.masterId, masterId), eq(waitingList.clientId, clientId)))
    .run();
}

async function closeWaitingList(masterId, clientId) {
  await db.delete(waitingList)
    .where(and(eq(waitingList.masterId, masterId), eq(waitingList.clientId, clientId)))
    .run();
}

// Ожидающие, чьи диапазоны покрывают дату (для уведомления об освободившемся окне).
export async function waitlistForDate(masterId, dateStr) {
  const rows = await db.select().from(waitingList)
    .where(eq(waitingList.masterId, masterId))
    .all();
  return rows.filter(
    (r) => (r.status === 'active' || r.status === 'notified')
      && r.dateFrom <= dateStr && dateStr <= r.dateTo,
  );
}

export async function markWaitlistNotified(entryId) {
  await db.update(waitingList).set({ status: 'notified' })
    .where(eq(waitingList.id, entryId)).run();
}

// ---------- Уведомления мастеру ----------

export async function masterChatId(masterId) {
  const m = await db.select().from(masters).where(eq(masters.id, masterId)).get();
  return m?.settings?.admin_chat_id || m?.tgChatId || null;
}

export async function clientChatId(clientId) {
  const c = await db.select().from(clients).where(eq(clients.id, clientId)).get();
  return c?.tgChatId || c?.tgUserId || null;
}