// endpoints/s1.js — ВРЕМЕННЫЙ: состояние после настроек и рассылки.
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters, mailings, reminders } from '../schema.js';

export default async function () {
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  const mail = await db.select().from(mailings).where(eq(mailings.masterId, m.id)).all();
  const rem = await db.select().from(reminders).where(eq(reminders.masterId, m.id)).all();
  return {
    master: {
      name: m.name,
      blurb: m.publicBlurb,
      auto_confirm: m.settings?.auto_confirm,
    },
    mailings: mail.map((x) => ({ id: x.id, status: x.status, sent: x.sent, failed: x.failed })),
    reminders: rem.length,
  };
}
