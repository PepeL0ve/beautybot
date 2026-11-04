// lib/svc/reminders.js — планирование и доставка напоминаний (spec §13).

import { db } from 'sdk';
import { and, eq, isNull, lt } from 'sdk/db';
import { reminders, appointments, clients, services, masters } from '../../schema.js';
import { localDate, localMin, minToHHMM, fmtDate } from '../time.js';
import { withDefaults } from './settings.js';
import { clientsWithMeta } from './crm.js';
import { waitlistForDate, markWaitlistNotified } from './booking.js';
import { slotsForDate } from './schedule.js';

// ---------- Планирование ----------

// Запланировать напоминания о записи (ap_before). При переносе/создании
// удаляем старые и создаём новые.
export async function planAppointmentReminders(appointment, master, nowSec) {
  const s = withDefaults(master.settings);
  // Удаляем старые ap_before для этой записи.
  await db.delete(reminders)
    .where(and(eq(reminders.appointmentId, appointment.id), eq(reminders.kind, 'ap_before')))
    .run();

  if (appointment.status !== 'pending' && appointment.status !== 'confirmed') return;

  for (const offsetMin of s.remind_offsets_min || []) {
    const sendAt = appointment.startsAt - offsetMin * 60;
    if (sendAt > nowSec) {
      await db.insert(reminders).values({
        masterId: master.id,
        appointmentId: appointment.id,
        clientId: appointment.clientId,
        kind: 'ap_before',
        sendAt,
        payload: { offsetMin },
      }).run();
    }
  }
}

// Удалить напоминания записи (при отмене/удалении).
export async function dropAppointmentReminders(appointmentId) {
  await db.delete(reminders).where(eq(reminders.appointmentId, appointmentId)).run();
}

// Запланировать напоминание мастеру о висящей заявке (pending_stale).
export async function planPendingStale(appointment, master, nowSec) {
  const s = withDefaults(master.settings);
  if (!s.pending_remind_min) return;
  const sendAt = nowSec + s.pending_remind_min * 60;
  await db.insert(reminders).values({
    masterId: master.id,
    appointmentId: appointment.id,
    clientId: appointment.clientId,
    kind: 'pending_stale',
    sendAt,
    payload: {},
  }).run();
}

// ---------- Доставка ----------

// Доставить все просроченные напоминания. Возвращает счётчики.
export async function deliverDue(nowSec, send) {
  const due = await db.select().from(reminders)
    .where(and(isNull(reminders.sentAt), lt(reminders.sendAt, nowSec)))
    .all();

  let sent = 0, failed = 0;
  for (const r of due) {
    const ok = await deliver(r, send);
    await db.update(reminders)
      .set({ sentAt: new Date() })
      .where(eq(reminders.id, r.id))
      .run();
    if (ok) sent++; else failed++;
  }
  return { sent, failed };
}

async function deliver(r, send) {
  const master = await db.select().from(masters).where(eq(masters.id, r.masterId)).get();
  if (!master) return false;
  master.settings = withDefaults(master.settings);

  if (r.kind === 'ap_before') {
    const ap = await db.select().from(appointments).where(eq(appointments.id, r.appointmentId)).get();
    if (!ap || ap.status !== 'confirmed') return true; // не нужно — снимаем
    const client = await db.select().from(clients).where(eq(clients.id, r.clientId)).get();
    if (!client || client.unreachable) return false;
    const chatId = client.tgChatId || client.tgUserId;
    if (!chatId) return false;
    const svc = ap.serviceId
      ? await db.select().from(services).where(eq(services.id, ap.serviceId)).get()
      : null;
    const dateStr = localDate(master.timezone, ap.startsAt);
    const time = minToHHMM(localMin(master.timezone, ap.startsAt));
    const offsetMin = r.payload?.offsetMin || 0;
    const when = offsetMin >= 1440 ? `завтра в ${time}` : `сегодня в ${time}`;
    const text = `⏰ <b>Напоминание о записи</b>\n\n💼 ${svc?.name || 'услуга'}\n📅 ${fmtDate(dateStr)} в ${time}\n👤 ${master.name}\n\nДо встречи ${when === 'сегодня в ' + time ? 'сегодня!' : 'завтра!'}`;
    return send(chatId, text);
  }

  if (r.kind === 'pending_stale') {
    const ap = await db.select().from(appointments).where(eq(appointments.id, r.appointmentId)).get();
    if (!ap || ap.status !== 'pending') return true; // уже обработано — снимаем
    const mChat = master.settings.admin_chat_id || master.tgChatId;
    if (!mChat) return false;
    return send(mChat, `⏳ <b>Заявка ждёт ответа уже ${master.settings.pending_remind_min} мин</b>\n\nОткройте карточку записи и подтвердите или отклоните.`);
  }

  return true;
}

// ---------- Дайджест «потеряшек» ----------

export async function lostClientsDigest(masterId, nowSec) {
  const master = await db.select().from(masters).where(eq(masters.id, masterId)).get();
  if (!master) return null;
  master.settings = withDefaults(master.settings);


  const all = await clientsWithMeta(master, nowSec);
  const lost = all.filter((c) => c.category === 'lost' && !c.archived && !c.blacklisted);

  if (!lost.length) return null;
  return {
    count: lost.length,
    names: lost.slice(0, 20).map((c) => c.displayName),
    clients: lost,
  };
}

// ---------- Дни рождения ----------

export async function birthdayDigest(masterId, nowSec) {
  const master = await db.select().from(masters).where(eq(masters.id, masterId)).get();
  if (!master || !master.settings.birthday_greet) return null;
  master.settings = withDefaults(master.settings);

  const today = localDate(master.timezone, nowSec);
  const tomorrow = localDate(master.timezone, nowSec + 86400);
  const todayMD = today.slice(5);
  const tomorrowMD = tomorrow.slice(5);

  const all = await db.select().from(clients)
    .where(eq(clients.masterId, masterId)).all();
  const active = all.filter((c) => !c.archived && !c.blacklisted && !c.unreachable && c.birthday);

  const todayList = active.filter((c) => c.birthday === todayMD);
  const tomorrowList = active.filter((c) => c.birthday === tomorrowMD);

  return { today: todayList, tomorrow: tomorrowList };
}

// ---------- Лист ожидания ----------

// Предложить освободившиеся окна: после отмены записи проверяем, есть ли
// активные заявки в этот день. Формируем reminders вместо прямой отправки
// (повторная доставка не дублируется — status active → notified).
export async function planWaitlistOffers(masterId, dateStr, nowSec) {


  const entries = await waitlistForDate(masterId, dateStr);
  if (!entries.length) return 0;

  // Есть ли свободные окна в этот день (по любой услуге — 30 мин пробник)?
  const master = await db.select().from(masters).where(eq(masters.id, masterId)).get();
  const slots = await slotsForDate(master, dateStr, 30, nowSec);
  if (!slots.length) return 0;

  let planned = 0;
  for (const e of entries) {
    // Одна заявка = одно уведомление до действия клиента.
    if (e.status === 'notified') continue;
    await db.insert(reminders).values({
      masterId,
      appointmentId: null,
      clientId: e.clientId,
      kind: 'waitlist_offer',
      sendAt: nowSec,
      payload: { dateStr, waitlistId: e.id },
    }).run();
    // Помечаем сразу, чтобы следующий sweep не плодил дубликаты.
  
    await markWaitlistNotified(e.id);
    planned++;
  }
  return planned;
}

// ---------- Недостижимость ----------

export async function markUnreachable(clientId) {
  await db.update(clients).set({ unreachable: true })
    .where(eq(clients.id, clientId)).run();
}

// Отменить все будущие напоминания недостижимого клиента.
export async function dropClientReminders(clientId) {
  await db.delete(reminders)
    .where(and(eq(reminders.clientId, clientId), isNull(reminders.sentAt)))
    .run();
}