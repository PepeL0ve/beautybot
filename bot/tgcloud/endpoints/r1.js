// endpoints/r1.js — ВРЕМЕННЫЙ интеграционный прогон напоминаний (Фаза 4).
import { db } from 'sdk';
import { and, eq, lt, isNull } from 'sdk/db';
import {
  masters, clients, appointments, reminders, waitingList, services, workHours, mailings,
} from '../schema.js';
import * as Rem from '../lib/svc/reminders.js';
import * as Mail from '../lib/svc/mailings.js';
import { localDate, addDays, zonedToEpoch, weekdayOf } from '../lib/time.js';

const P = -777005;
const TZ = 'Europe/Moscow';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  try {
    await fn();
    return { test: name, ok: true };
  } catch (e) {
    return { test: name, ok: false, error: String((e && e.message) || e) };
  }
}
async function wipe() {
  await db.delete(reminders).where(eq(reminders.masterId, P)).run();
  await db.delete(waitingList).where(eq(waitingList.masterId, P)).run();
  await db.delete(appointments).where(eq(appointments.masterId, P)).run();
  await db.delete(clients).where(eq(clients.masterId, P)).run();
  await db.delete(workHours).where(eq(workHours.masterId, P)).run();
  await db.delete(services).where(eq(services.masterId, P)).run();
  await db.delete(masters).where(eq(masters.id, P)).run();
}

export default async function () {
  const nowSec = Math.floor(Date.now() / 1000);
  const today = localDate(TZ, nowSec);
  const results = [];
  await wipe();

  // Создаём тестового мастера
  const master = {
    id: P, tgUserId: -900200, tgChatId: -900200, name: 'Тестовый Мастер',
    masterCode: 'TESTR01', timezone: TZ,
    settings: {
      auto_confirm: false, only_existing: false, sticky_min: 0, min_lead_min: 0,
      book_days_ahead: 14, remind_offsets_min: [1440, 120], pending_remind_min: 120,
      regular_visits: 3, lost_days: 30, auto_income: true, birthday_greet: true,
      admin_chat_id: -900200,
    },
  };
  await db.insert(masters).values(master).run();

  const svc = await db.insert(services).values({
    masterId: P, name: 'Тест', durationMin: 60, priceCents: 100000, active: true,
  }).returning().then((r) => r[0]);

  // Ближайший понедельник
  let day = today;
  while (weekdayOf(day) !== 0) day = addDays(day, 1);

  await db.insert(workHours).values({
    masterId: P, weekday: 0, startMin: 600, endMin: 1140, enabled: true,
  }).run();

  // --- T13: напоминания о записи ---
  let clientId;
  results.push(await check('T13 reminders planned on booking', async () => {
    const c = await db.insert(clients).values({
      masterId: P, tgUserId: -900201, displayName: 'Клиент А',
      blacklisted: false, archived: false, unreachable: false,
    }).returning().then((r) => r[0]);
    clientId = c.id;

    const start = zonedToEpoch(TZ, day, 600);
    const ap = {
      id: 999, masterId: P, clientId: c.id, serviceId: svc.id,
      startsAt: start, endsAt: start + 3600, status: 'confirmed', priceCents: 100000,
    };
    await Rem.planAppointmentReminders(ap, master, nowSec);

    const planned = await db.select().from(reminders)
      .where(eq(reminders.appointmentId, 999)).all();
    assert(planned.length === 2, 'planned=' + planned.length);
    assert(planned.every((r) => r.kind === 'ap_before'), 'kind');
    assert(planned.every((r) => r.clientId === c.id), 'client');
  }));

  results.push(await check('T13 no duplicate reminders on replan', async () => {
    const ap = {
      id: 999, masterId: P, clientId, serviceId: svc.id,
      startsAt: zonedToEpoch(TZ, day, 600), endsAt: zonedToEpoch(TZ, day, 600) + 3600,
      status: 'confirmed', priceCents: 100000,
    };
    await Rem.planAppointmentReminders(ap, master, nowSec);
    await Rem.planAppointmentReminders(ap, master, nowSec);
    const planned = await db.select().from(reminders)
      .where(eq(reminders.appointmentId, 999)).all();
    assert(planned.length === 2, 'still 2');
  }));

  results.push(await check('T13 cancel drops reminders', async () => {
    await Rem.dropAppointmentReminders(999);
    const left = await db.select().from(reminders)
      .where(eq(reminders.appointmentId, 999)).all();
    assert(left.length === 0, 'left=' + left.length);
  }));

  // --- Pending stale ---
  results.push(await check('T13 pending_stale planned', async () => {
    const ap = {
      id: 998, masterId: P, clientId, serviceId: svc.id,
      startsAt: zonedToEpoch(TZ, day, 720), endsAt: zonedToEpoch(TZ, day, 720) + 3600,
      status: 'pending', priceCents: 100000,
    };
    await Rem.planPendingStale(ap, master, nowSec);
    const planned = await db.select().from(reminders)
      .where(and(eq(reminders.appointmentId, 998), eq(reminders.kind, 'pending_stale'))).all();
    assert(planned.length === 1, 'planned=' + planned.length);
    assert(planned[0].sendAt === nowSec + 120 * 60, 'sendAt');
  }));

  // --- Lost clients ---
  results.push(await check('T13 lost clients digest', async () => {
    // Клиент с визитом 40 дней назад (completed)
    const c = await db.insert(clients).values({
      masterId: P, tgUserId: -900202, displayName: 'Потерянный',
      blacklisted: false, archived: false, unreachable: false,
    }).returning().then((r) => r[0]);
    const past = zonedToEpoch(TZ, addDays(today, -40), 600);
    await db.insert(appointments).values({
      masterId: P, clientId: c.id, serviceId: svc.id,
      startsAt: past, endsAt: past + 3600, status: 'completed', priceCents: 100000,
    }).run();

    const digest = await Rem.lostClientsDigest(P, nowSec);
    assert(digest !== null, 'digest exists');
    assert(digest.count === 1, 'count=' + digest.count);
    assert(digest.names[0] === 'Потерянный', 'name');
  }));

  // --- Дни рождения ---
  results.push(await check('T13 birthday digest', async () => {
    const todayMD = today.slice(5); // 'MM-DD'
    const tomorrowMD = addDays(today, 1).slice(5);
    await db.insert(clients).values({
      masterId: P, tgUserId: -900203, displayName: 'Именинник',
      birthday: todayMD, blacklisted: false, archived: false, unreachable: false,
    }).run();
    await db.insert(clients).values({
      masterId: P, tgUserId: -900204, displayName: 'Завтрашний',
      birthday: tomorrowMD, blacklisted: false, archived: false, unreachable: false,
    }).run();

    const digest = await Rem.birthdayDigest(P, nowSec);
    assert(digest !== null, 'digest exists');
    assert(digest.today.length === 1, 'today=' + digest.today.length);
    assert(digest.tomorrow.length === 1, 'tomorrow=' + digest.tomorrow.length);
  }));

  // --- T14: недостижимость ---
  results.push(await check('T14 unreachable drops reminders', async () => {
    const c = await db.select().from(clients)
      .where(eq(clients.tgUserId, -900201)).get();
    await Rem.markUnreachable(c.id);
    await Rem.dropClientReminders(c.id);
    const left = await db.select().from(reminders)
      .where(eq(reminders.clientId, c.id)).all();
    assert(left.length === 0, 'left=' + left.length);
    const after = await db.select().from(clients).where(eq(clients.id, c.id)).get();
    assert(after.unreachable === true, 'flag set');
  }));

  // --- T15: рассылка чанками ---
  results.push(await check('T15 mailing audience respects unreachable', async () => {
    const aud = await Mail.audienceFor(master, 'all', null);
    const names = aud.map((c) => c.displayName);
    assert(!names.includes('Клиент А'), 'unreachable excluded');
    assert(names.includes('Потерянный'), 'reachable included');
    assert(!aud.some((c) => c.tgUserId === -900201), 'unreachable excluded by tg');
  }));

  results.push(await check('T15 mailing create + chunk', async () => {
    const mailing = await Mail.createMailing(master, {
      text: 'Тестовая рассылка {имя}', targetKind: 'all', targetRef: null,
    });
    assert(mailing.status === 'sending', 'status');
    assert(mailing.cursor === 0, 'cursor 0');

    const r1 = await Mail.sendChunk(mailing, master, async () => true);
    assert(r1.done === false, 'not done yet');
    assert(r1.sent === 3, 'sent=' + r1.sent); // 3 достижимых

    const updated = await db.select().from(mailings).where(eq(mailings.id, mailing.id)).get();
    assert(updated.cursor > 0, 'cursor advanced');

    // Второй чанк — должен завершить
    const r2 = await Mail.sendChunk({ ...mailing, cursor: updated.cursor }, master, async () => true);
    assert(r2.done === true, 'done');
  }));

  results.push(await check('T15 mailing by category', async () => {
    const lost = await Mail.audienceFor(master, 'category', 'lost');
    assert(lost.length === 1, 'lost=' + lost.length);
    assert(lost[0].displayName === 'Потерянный', 'right client');
  }));

  results.push(await check('T15 mailing report', async () => {
    const mailing = await Mail.createMailing(master, {
      text: 'Отчёт', targetKind: 'all', targetRef: null,
    });
    const r1 = await Mail.sendChunk(mailing, master, async () => true);
    assert(r1.done === false, 'not done');
    const r2 = await Mail.sendChunk({ ...mailing, cursor: r1.cursor }, master, async () => true);
    assert(r2.done === true, 'done');
    const report = await Mail.mailingReport(P, mailing.id);
    assert(report.total === 3, 'total=' + report.total);
    assert(report.done === true, 'done');
  }));

  // --- waitlist offers ---
  results.push(await check('T15 waitlist offer planned', async () => {
    const c = await db.insert(clients).values({
      masterId: P, tgUserId: -900205, displayName: 'Ждун',
      blacklisted: false, archived: false, unreachable: false,
    }).returning().then((r) => r[0]);
    await db.insert(waitingList).values({
      masterId: P, clientId: c.id, serviceId: svc.id,
      dateFrom: day, dateTo: addDays(day, 7), status: 'active',
    }).run();

    const n = await Rem.planWaitlistOffers(P, day, nowSec);
    assert(n === 1, 'planned=' + n);

    const remindersRows = await db.select().from(reminders)
      .where(eq(reminders.kind, 'waitlist_offer')).all();
    assert(remindersRows.length === 1, 'reminder created');
    assert(remindersRows[0].payload.dateStr === day, 'date');
  }));

  await wipe();
  return {
    total: results.length,
    passed: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok),
  };
}