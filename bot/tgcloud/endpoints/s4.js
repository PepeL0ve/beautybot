// endpoints/s4.js — ВРЕМЕННЫЙ: создать тестовых клиентов для рассылки.
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters, clients } from '../schema.js';

export default async function () {
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  const existing = await db.select().from(clients).where(eq(clients.masterId, m.id)).all();
  if (existing.length) return { skipped: true, count: existing.length };

  const created = [];
  for (let i = 1; i <= 3; i++) {
    const c = await db.insert(clients).values({
      masterId: m.id,
      tgUserId: 777555000 + i,
      displayName: `Тестовый Клиент ${i}`,
      blacklisted: false, archived: false, unreachable: false,
    }).returning();
    created.push(c[0].id);
  }
  return { created: created.length, ids: created };
}
