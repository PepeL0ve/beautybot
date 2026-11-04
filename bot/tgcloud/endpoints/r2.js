// endpoints/r2.js — ВРЕМЕННЫЙ: диагностика аудитории рассылок.
import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { masters, clients } from '../schema.js';
import * as Mail from '../lib/svc/mailings.js';
import { localDate } from '../lib/time.js';

const P = -777006;
const TZ = 'Europe/Moscow';

export default async function () {
  const nowSec = Math.floor(Date.now() / 1000);
  await db.delete(clients).where(eq(clients.masterId, P)).run();
  await db.delete(masters).where(eq(masters.id, P)).run();

  const master = {
    id: P, tgUserId: -900300, tgChatId: -900300, name: 'М', masterCode: 'TSTR06',
    timezone: TZ,
    settings: { auto_confirm: false, only_existing: false, sticky_min: 0, min_lead_min: 0, book_days_ahead: 14, remind_offsets_min: [1440, 120], pending_remind_min: 120, regular_visits: 3, lost_days: 30, auto_income: true, birthday_greet: true, admin_chat_id: -900300 },
  };
  await db.insert(masters).values(master).run();

  const clientsData = [
    { tgUserId: -900301, displayName: 'Нормальный', unreachable: false },
    { tgUserId: -900302, displayName: 'Недостижимый', unreachable: true },
    { tgUserId: -900303, displayName: 'В ЧС', blacklisted: true, unreachable: false },
  ];
  for (const c of clientsData) {
    await db.insert(clients).values({ masterId: P, ...c, blacklisted: !!c.blacklisted, archived: false }).run();
  }

  const aud = await Mail.audienceFor(master, 'all', null);
  return {
    audience: aud.map((c) => ({ id: c.id, name: c.displayName, tg: c.tgUserId, unreach: c.unreachable, bl: c.blacklisted })),
    count: aud.length,
  };
}
