// lib/svc/mailings.js — массовые рассылки чанками (spec §15).

import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { mailings, clients, clientGroupMembers } from '../../schema.js';
import { clientsWithMeta } from './crm.js';
import { markUnreachable } from './reminders.js';

const CHUNK = 20; // максимум сообщений за один проход (безопасно для 30 msg/с)

// ---------- Создание ----------

export async function createMailing(master, { text, targetKind, targetRef }) {
  const rows = await db.insert(mailings).values({
    masterId: master.id,
    text: String(text).slice(0, 2000),
    targetKind,
    targetRef: targetRef || null,
    status: 'sending',
    sent: 0,
    failed: 0,
    cursor: 0,
  }).returning();
  return rows[0];
}

// ---------- Аудитория ----------

// Активные достижимые клиенты, отсортированные по id (для стабильного курсора).
export async function audienceFor(master, targetKind, targetRef) {
  const all = await clientsWithMeta(master, Math.floor(Date.now() / 1000));
  let pool = all.filter((c) => !c.archived && !c.blacklisted && !c.unreachable);

  if (targetKind === 'group') {
    const gid = Number(targetRef);
    const members = await db.select().from(clientGroupMembers)
      .where(eq(clientGroupMembers.groupId, gid)).all();
    const ids = new Set(members.map((m) => m.clientId));
    pool = pool.filter((c) => ids.has(c.id));
  } else if (targetKind === 'category') {
    pool = pool.filter((c) => c.category === targetRef);
  }
  // 'all' — без дополнительных фильтров

  return pool
    .filter((c) => c.tgChatId || c.tgUserId)
    .sort((a, b) => a.id - b.id);
}

// ---------- Отправка ----------

// Продвинуть рассылку на один чанк. Возвращает статистику прохода.
export async function sendChunk(mailing, master, send) {
  if (mailing.status !== 'sending') return { done: true };

  const audience = await audienceFor(master, mailing.targetKind, mailing.targetRef);
  const remaining = audience.filter((c) => c.id > mailing.cursor);
  if (!remaining.length) {
    await finish(mailing.id, audience);
    return { done: true, total: audience.length };
  }

  const chunk = remaining.slice(0, CHUNK);
  let sent = 0, failed = 0;

  for (const c of chunk) {
    const chatId = c.tgChatId || c.tgUserId;
    const ok = await send(chatId, mailing.text.replace(/\{имя\}/g, c.displayName));
    if (ok) sent++;
    else {
      failed++;
      // 403 — пометить как недостижимого, чтобы не мучить бота
      await markUnreachable(c.id);
    }
  }

  await db.update(mailings).set({
    sent: mailing.sent + sent,
    failed: mailing.failed + failed,
    cursor: chunk[chunk.length - 1].id,
  }).where(eq(mailings.id, mailing.id)).run();

  return { done: false, sent, failed, remaining: remaining.length - chunk.length };
}

async function finish(mailingId, audience) {
  await db.update(mailings).set({ status: 'done' })
    .where(eq(mailings.id, mailingId)).run();
  return { sent: audience.length, failed: 0 };
}

// ---------- Отчёт ----------

export async function mailingReport(masterId, mailingId) {
  const m = await db.select().from(mailings)
    .where(and(eq(mailings.masterId, masterId), eq(mailings.id, mailingId))).get();
  if (!m) return null;

  const total = m.sent + m.failed;
  const noTg = await db.select().from(clients)
    .where(and(eq(clients.masterId, masterId), eq(clients.unreachable, true))).all();
  return {
    ...m,
    total,
    noTgCount: noTg.length,
    done: m.status === 'done',
  };
}

// Все незавершённые рассылки мастера (для sweep).
export async function pendingMailings(masterId) {
  return db.select().from(mailings)
    .where(and(eq(mailings.masterId, masterId), eq(mailings.status, 'sending')))
    .all();
}

// ---------- Для Фазы 5: аудитория по категории ----------

export async function audienceByCategory(master, category) {
  return audienceFor(master, 'category', category);
}

export async function audienceByGroup(master, groupId) {
  return audienceFor(master, 'group', groupId);
}

export async function audienceAll(master) {
  return audienceFor(master, 'all', null);
}