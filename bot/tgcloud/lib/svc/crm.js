// lib/svc/crm.js — CRM: категории клиентов, статистика визитов, группы,
// фильтры и пагинация (spec §9).

import { db } from 'sdk';
import { and, eq, inArray } from 'sdk/db';
import {
  clients, appointments, clientGroups, clientGroupMembers, reviews, services,
} from '../../schema.js';
import { localDate, diffDays } from '../time.js';
import { withDefaults } from './settings.js';

// Категории (spec §9): new | regular | lost. Визиты считаем по completed.
export function categorize(stats, settings, todayStr) {
  const s = withDefaults(settings);
  if (!stats.visits) return 'new';
  if (stats.lastVisitDate && diffDays(stats.lastVisitDate, todayStr) >= s.lost_days) return 'lost';
  if (stats.visits >= s.regular_visits) return 'regular';
  return 'new';
}

export const CATEGORY_LABEL = {
  new: '🆕 Новый',
  regular: '⭐ Постоянный',
  lost: '😴 Потеряшка',
  blacklist: '⛔ Чёрный список',
  archived: '📦 В архиве',
};

// Статистика по клиентам мастера одним проходом.
export async function clientStats(masterId, tz, nowSec) {
  const todayStr = localDate(tz, nowSec);
  const rows = await db
    .select()
    .from(appointments)
    .where(eq(appointments.masterId, masterId))
    .all();

  const map = new Map();
  for (const a of rows) {
    const st = map.get(a.clientId) || { visits: 0, totalSpent: 0, lastVisitDate: null, lastVisitAt: null };
    if (a.status === 'completed') {
      st.visits += 1;
      st.totalSpent += a.priceCents || 0;
      if (!st.lastVisitAt || a.startsAt > st.lastVisitAt) {
        st.lastVisitAt = a.startsAt;
        st.lastVisitDate = localDate(tz, a.startsAt);
      }
    }
    if (a.status === 'pending' || a.status === 'confirmed') st.upcoming = (st.upcoming || 0) + 1;
    if (a.status === 'no_show') st.noShows = (st.noShows || 0) + 1;
    map.set(a.clientId, st);
  }
  return { todayStr, map };
}

// Полный список с категориями и метаданными.
export async function clientsWithMeta(master, nowSec) {
  const [all, { todayStr, map }] = await Promise.all([
    db.select().from(clients).where(eq(clients.masterId, master.id)).all(),
    clientStats(master.id, master.timezone, nowSec),
  ]);
  return all.map((c) => {
    const st = map.get(c.id) || { visits: 0, totalSpent: 0, lastVisitDate: null, upcoming: 0 };
    const category = c.blacklisted
      ? 'blacklist'
      : c.archived ? 'archived' : categorize(st, master.settings, todayStr);
    return { ...c, stats: st, category };
  });
}

export const FILTERS = {
  all: { label: 'Все', test: (c) => !c.archived && !c.blacklisted },
  new: { label: '🆕 Новые', test: (c) => c.category === 'new' && !c.archived },
  regular: { label: '⭐ Постоянные', test: (c) => c.category === 'regular' && !c.archived },
  lost: { label: '😴 Потеряшки', test: (c) => c.category === 'lost' && !c.archived },
  blacklist: { label: '⛔ Чёрный список', test: (c) => c.blacklisted },
  archived: { label: '📦 Архив', test: (c) => c.archived },
};

export function filterClients(list, filterKey, query) {
  const f = FILTERS[filterKey] || FILTERS.all;
  let rows = list.filter(f.test);
  const q = String(query || '').trim().toLowerCase();
  if (q) {
    // Телефон сравниваем только если в запросе есть цифры:
    // ''.includes('') == true, иначе совпали бы все клиенты.
    const digits = q.replace(/\D/g, '');
    rows = rows.filter(
      (c) =>
        c.displayName.toLowerCase().includes(q) ||
        (c.username || '').toLowerCase().includes(q) ||
        (digits.length > 0 && (c.phone || '').replace(/\D/g, '').includes(digits)),
    );
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
}

export const PAGE_SIZE = 8;

export function pageOf(rows, page) {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page | 0), pages - 1);
  return {
    items: rows.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE),
    page: p,
    pages,
    total: rows.length,
  };
}

// ---------- Карточка клиента ----------

export async function clientCardData(master, clientId, nowSec) {
  const client = await db
    .select()
    .from(clients)
    .where(and(eq(clients.masterId, master.id), eq(clients.id, clientId)))
    .get();
  if (!client) return null;

  const history = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.masterId, master.id), eq(appointments.clientId, clientId)))
    .all();
  const svcIds = [...new Set(history.map((a) => a.serviceId).filter(Boolean))];
  const svcRows = svcIds.length
    ? await db.select().from(services).where(inArray(services.id, svcIds)).all()
    : [];
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));

  history.sort((a, b) => b.startsAt - a.startsAt);
  const completed = history.filter((a) => a.status === 'completed');
  const stats = {
    visits: completed.length,
    totalSpent: completed.reduce((sum, a) => sum + (a.priceCents || 0), 0),
    lastVisitAt: completed.length ? completed[0].startsAt : null,
    lastVisitDate: completed.length ? localDate(master.timezone, completed[0].startsAt) : null,
    upcoming: history.filter((a) => a.status === 'pending' || a.status === 'confirmed').length,
    noShows: history.filter((a) => a.status === 'no_show').length,
  };

  const todayStr = localDate(master.timezone, nowSec);
  const category = client.blacklisted
    ? 'blacklist'
    : client.archived ? 'archived' : categorize(stats, master.settings, todayStr);

  const groups = await groupsOfClient(master.id, clientId);
  const reviewRows = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.masterId, master.id), eq(reviews.clientId, clientId)))
    .all();

  return {
    client,
    stats,
    category,
    groups,
    reviews: reviewRows,
    history: history.slice(0, 10).map((a) => ({
      ...a,
      serviceName: a.serviceId ? svcMap.get(a.serviceId)?.name || null : null,
      dateStr: localDate(master.timezone, a.startsAt),
    })),
  };
}

export function reviewsSummary(reviewRows) {
  if (!reviewRows.length) return null;
  const avg = reviewRows.reduce((s, r) => s + r.rating, 0) / reviewRows.length;
  return { avg, count: reviewRows.length };
}

// ---------- Группы ----------

export async function listGroups(masterId) {
  return db
    .select()
    .from(clientGroups)
    .where(eq(clientGroups.masterId, masterId))
    .all();
}

export async function createGroup(masterId, name) {
  const rows = await db
    .insert(clientGroups)
    .values({ masterId, name: String(name).trim().slice(0, 60) })
    .returning();
  return rows[0];
}

export async function deleteGroup(masterId, groupId) {
  await db
    .delete(clientGroupMembers)
    .where(eq(clientGroupMembers.groupId, groupId))
    .run();
  await db
    .delete(clientGroups)
    .where(and(eq(clientGroups.masterId, masterId), eq(clientGroups.id, groupId)))
    .run();
}

export async function groupMembers(groupId) {
  return db
    .select()
    .from(clientGroupMembers)
    .where(eq(clientGroupMembers.groupId, groupId))
    .all();
}

export async function groupsOfClient(masterId, clientId) {
  const members = await db
    .select()
    .from(clientGroupMembers)
    .where(eq(clientGroupMembers.clientId, clientId))
    .all();
  if (!members.length) return [];
  const ids = members.map((m) => m.groupId);
  const rows = await db
    .select()
    .from(clientGroups)
    .where(and(eq(clientGroups.masterId, masterId), inArray(clientGroups.id, ids)))
    .all();
  return rows;
}

export async function isInGroup(groupId, clientId) {
  const row = await db
    .select()
    .from(clientGroupMembers)
    .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.clientId, clientId)))
    .get();
  return !!row;
}

export async function toggleGroupMember(groupId, clientId) {
  const exists = await isInGroup(groupId, clientId);
  if (exists) {
    await db
      .delete(clientGroupMembers)
      .where(and(eq(clientGroupMembers.groupId, groupId), eq(clientGroupMembers.clientId, clientId)))
      .run();
    return false;
  }
  await db.insert(clientGroupMembers).values({ groupId, clientId }).run();
  return true;
}

export async function updateClient(masterId, clientId, patch) {
  const rows = await db
    .update(clients)
    .set(patch)
    .where(and(eq(clients.masterId, masterId), eq(clients.id, clientId)))
    .returning();
  return rows[0] || null;
}

// Удаление клиента: запрещено, если есть активные (pending/confirmed) записи.
export async function deleteClient(masterId, clientId) {
  const active = await db
    .select({ id: appointments.id, status: appointments.status })
    .from(appointments)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.clientId, clientId)))
    .all();
  const blocking = active.filter((a) => a.status === 'pending' || a.status === 'confirmed');
  if (blocking.length) return { ok: false, reason: 'HAS_ACTIVE' };

  await db
    .delete(reviews)
    .where(and(eq(reviews.masterId, masterId), eq(reviews.clientId, clientId)))
    .run();
  await db.delete(clientGroupMembers).where(eq(clientGroupMembers.clientId, clientId)).run();
  await db
    .delete(appointments)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.clientId, clientId)))
    .run();
  await db
    .delete(clients)
    .where(and(eq(clients.masterId, masterId), eq(clients.id, clientId)))
    .run();
  return { ok: true };
}

// Аудитория для рассылок (Фаза 4): активные достижимые клиенты.
// В приватном чате tg_chat_id совпадает с tg_user_id — допускаем оба варианта
// (ручные записи с заданным tg_chat_id тоже должны попадать в рассылку).
export async function mailingAudience(masterId) {
  const all = await db.select().from(clients).where(eq(clients.masterId, masterId)).all();
  return all.filter(
    (c) => !c.archived && !c.blacklisted && !c.unreachable && (c.tgChatId || c.tgUserId),
  );
}