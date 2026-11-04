// endpoints/s5.js — ВРЕМЕННЫЙ: T13 — напоминание клиенту о записи.
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters, clients, appointments, reminders } from '../schema.js';
import { localDate, addDays, zonedToEpoch, weekdayOf } from '../lib/time.js';
import { planAppointmentReminders } from '../lib/svc/reminders.js';
import { runSweep } from '../lib/svc/sweep.js';

const TZ = 'Europe/Moscow';

export default async function () {
  const nowSec = Math.floor(Date.now() / 1000);
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  const c = await db.insert(clients).values({
    masterId: m.id, tgUserId: 777555555, displayName: 'Нина Напоминание',
    blacklisted: false, archived: false, unreachable: false,
  }).returning().then((r) => r[0]);

  // Запись завтра в 10:00 (понедельник)
  let day = addDays(localDate(TZ, nowSec), 1);
  while (weekdayOf(day) !== 0) day = addDays(day, 1);
  const start = zonedToEpoch(TZ, day, 600);
  const ap = {
    id: 0, masterId: m.id, clientId: c.id,
    startsAt: start, endsAt: start + 3600, status: 'confirmed',
  };

  // Планируем напоминание
  await planAppointmentReminders(ap, m, nowSec);

  // Проверяем, что напоминание создано
  const planned = await db.select().from(reminders)
    .where(eq(reminders.appointmentId, ap.id)).all();

  // Проверяем доставку через sweep
  const sweepRes = await runSweep(nowSec);

  return {
    planned: planned.length,
    sweep: sweepRes,
    clientId: c.id,
  };
}
