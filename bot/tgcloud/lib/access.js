// lib/access.js — белый список и резолвер арендатора (spec §3).

import { db } from 'sdk';
import { eq } from 'sdk/db';
import { accessList, masters } from '../schema.js';
import { withDefaults } from './svc/settings.js';

export async function isAllowed(tgUserId) {
  const row = await db.select().from(accessList).where(eq(accessList.tgUserId, tgUserId)).get();
  return !!row;
}

// Мастер по tg_user_id; settings приводятся к полному виду.
export async function getMasterByTg(tgUserId) {
  const row = await db.select().from(masters).where(eq(masters.tgUserId, tgUserId)).get();
  if (row) row.settings = withDefaults(row.settings);
  return row;
}

export async function getMasterByCode(code) {
  const row = await db.select().from(masters).where(eq(masters.masterCode, code)).get();
  if (row) row.settings = withDefaults(row.settings);
  return row;
}

export async function getMasterById(id) {
  const row = await db.select().from(masters).where(eq(masters.id, id)).get();
  if (row) row.settings = withDefaults(row.settings);
  return row;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов

export function generateMasterCode(len = 8) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

export async function createMaster({ tgUserId, tgChatId, name, timezone }) {
  let code = generateMasterCode();
  // Код уникален — при коллизии пробуем снова (вероятность ничтожна).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const inserted = await db
        .insert(masters)
        .values({
          tgUserId,
          tgChatId,
          name,
          timezone,
          masterCode: code,
          settings: withDefaults({ admin_chat_id: tgChatId }),
        })
        .returning();
      const row = Array.isArray(inserted) ? inserted[0] : inserted;
      row.settings = withDefaults(row.settings);
      return row;
    } catch (e) {
      if (String(e?.message || e).includes('master_code')) {
        code = generateMasterCode();
        continue;
      }
      throw e;
    }
  }
  throw new Error('cannot generate unique master code');
}
