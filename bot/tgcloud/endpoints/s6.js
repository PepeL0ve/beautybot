// endpoints/s6.js — ВРЕМЕННЫЙ: T13 без создания клиента (используем существующего).
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters, clients, reminders } from '../schema.js';
import { localDate, addDays, zonedToEpoch, weekdayOf } from '../lib/time.js';
import { planAppointmentReminders } from '../lib/svc/reminders.js';
import { runSweep } from '../lib/svc/sweep.js';

const TZ = 'Europe/Moscow';

export default async function () {
  const nowSec = Math.floor(Date.now() / 1000);
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  m.settings = m.settings || {};

  // Берём первого клиента (созданного в предыдущих тестах)
  const existing = await db.select().from(clients).where(eq(clients.masterId, m.id)).all();
  if (!existing.length) return { error: 'no clients' };
  const c = existing[0];

  // Запись завтра в 10:00
  let day = addDays(localDate(TZ, nowSec), 1);
  while (weekdayOf(day) !== 0) day = addDays(day, 1);
  const start = zonedToEpoch(TZ, day, 600);
  const ap = {
    id: 888, masterId: m.id, clientId: c.id,
    startsAt: start, endsAt: start + 3600, status: 'confirmed',
  };

  await planAppointmentReminders(ap, m, nowSec);

  const planned = await db.select().from(reminders)
    .where(eq(reminders.appointmentId, 888)).all();

  // Sweep должен доставить (если sendAt уже прошёл)
  const sweepRes = await runSweep(nowSec);

  return {
    planned: planned.length,
    sweep: sweepRes,
    clientId: c.id,
    clientName: c.displayName,
  };
}
