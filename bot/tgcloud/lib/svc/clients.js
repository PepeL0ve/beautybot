// lib/svc/clients.js — минимальный клиентский слой для ручных записей.
// Полноценный CRM (поиск, категории, группы, архив) — Фаза 2.

import { db } from 'sdk';
import { and, eq } from 'sdk/db';
import { clients } from '../../schema.js';

export async function getClient(masterId, id) {
  return db
    .select()
    .from(clients)
    .where(and(eq(clients.masterId, masterId), eq(clients.id, id)))
    .get();
}

export async function findClientByTg(masterId, tgUserId) {
  return db
    .select()
    .from(clients)
    .where(and(eq(clients.masterId, masterId), eq(clients.tgUserId, tgUserId)))
    .get();
}

export async function listClients(masterId, { includeArchived = false } = {}) {
  const rows = await db
    .select()
    .from(clients)
    .where(eq(clients.masterId, masterId))
    .all();
  return rows.filter((c) => includeArchived || !c.archived);
}

export async function createClient(masterId, data) {
  const rows = await db
    .insert(clients)
    .values({
      masterId,
      tgUserId: data.tgUserId ?? null,
      tgChatId: data.tgChatId ?? null,
      displayName: String(data.displayName).trim().slice(0, 80),
      phone: data.phone ? String(data.phone).slice(0, 32) : null,
      username: data.username || null,
      birthday: data.birthday || null,
      notes: data.notes || null,
      blacklisted: false,
      archived: false,
      unreachable: false,
    })
    .returning();
  return rows[0];
}

export async function findOrCreateClientByTg(masterId, from) {
  const existing = await findClientByTg(masterId, from.id);
  if (existing) return existing;
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Клиент';
  return createClient(masterId, {
    tgUserId: from.id,
    tgChatId: from.id,
    displayName: name,
    username: from.username || null,
  });
}

// Поиск по подстроке имени или телефону (для FSM выбора клиента).
export async function searchClients(masterId, query) {
  const q = String(query || '').trim().toLowerCase();
  const all = await listClients(masterId);
  if (!q) return all.slice(0, 10);
  return all
    .filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '')),
    )
    .slice(0, 10);
}