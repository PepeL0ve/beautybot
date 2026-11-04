// handlers/my_chat_member.js — блокировка/разблокировка бота (spec §13).
// Если пользователь заблокировал бота (my_chat_member.status = 'kicked'),
// помечаем его клиента как недостижимого во всех мастерах.

import { db } from 'sdk';
import { eq } from 'sdk/db';
import { clients } from '../schema.js';

export default async function (memberUpdate, ctx) {
  const status = memberUpdate?.new_chat_member?.status;
  const fromId = memberUpdate?.from?.id;
  if (!fromId || !status) return;

  if (status === 'kicked' || status === 'left') {
    // Помечаем недостижимым у всех мастеров, где он есть.
    const rows = await db.select().from(clients).where(eq(clients.tgUserId, fromId)).all();
    for (const c of rows) {
      await db.update(clients).set({ unreachable: true })
        .where(eq(clients.id, c.id)).run();
    }
    if (rows.length) console.info(`client ${fromId} blocked bot, marked unreachable`);
  }

  if (status === 'member') {
    // Разблокировал — снимаем флаг недостижимости.
    const rows = await db.select().from(clients).where(eq(clients.tgUserId, fromId)).all();
    for (const c of rows) {
      if (c.unreachable) {
        await db.update(clients).set({ unreachable: false })
          .where(eq(clients.id, c.id)).run();
      }
    }
  }
}