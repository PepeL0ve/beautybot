// endpoints/s3.js — ВРЕМЕННЫЙ: тест аудитории для владельца.
import { db } from 'sdk';
import { eq } from 'sdk/db';
import { masters } from '../schema.js';
import { audienceFor } from '../lib/svc/mailings.js';

export default async function () {
  const m = await db.select().from(masters).where(eq(masters.tgUserId, 969434663)).get();
  m.settings = m.settings || {};
  const aud = await audienceFor(m, 'all', null);
  return { count: aud.length, names: aud.map((c) => c.displayName) };
}
