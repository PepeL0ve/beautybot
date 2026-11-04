// endpoints/s2.js — ВРЕМЕННЫЙ: состояние FSM и рассылок.
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters, botStates, mailings } from '../schema.js';

export default async function () {
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  const st = await db.select().from(botStates).where(eq(botStates.chatId, 969434663)).get();
  const mail = await db.select().from(mailings).where(eq(mailings.masterId, m.id)).all();
  return {
    state: st ? { state: st.state, data: st.data } : null,
    mailings: mail.map((x) => ({ id: x.id, status: x.status, text: x.text?.slice(0, 50) })),
  };
}
