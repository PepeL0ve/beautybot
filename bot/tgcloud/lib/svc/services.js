// lib/svc/services.js — каталог услуг мастера (spec §5).

import { db } from 'sdk';
import { and, eq, asc } from 'sdk/db';
import { services, appointments } from '../../schema.js';

export async function listServices(masterId, { includeInactive = false } = {}) {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.masterId, masterId))
    .orderBy(asc(services.sort), asc(services.id))
    .all();
  return includeInactive ? rows : rows.filter((r) => r.active);
}

export async function getService(masterId, id) {
  return db
    .select()
    .from(services)
    .where(and(eq(services.masterId, masterId), eq(services.id, id)))
    .get();
}

export async function createService(masterId, data) {
  const all = await db.select().from(services).where(eq(services.masterId, masterId)).all();
  const nextSort = all.reduce((max, r) => Math.max(max, r.sort || 0), 0) + 10;
  const rows = await db
    .insert(services)
    .values({
      masterId,
      name: String(data.name).trim().slice(0, 80),
      durationMin: data.durationMin,
      priceCents: data.priceCents || 0,
      priceFrom: !!data.priceFrom,
      description: data.description ? String(data.description).slice(0, 300) : null,
      isPopular: !!data.isPopular,
      sort: nextSort,
      active: true,
    })
    .returning();
  return rows[0];
}

export async function updateService(masterId, id, patch) {
  const rows = await db
    .update(services)
    .set(patch)
    .where(and(eq(services.masterId, masterId), eq(services.id, id)))
    .returning();
  return rows[0] || null;
}

// Удалить можно только услугу без будущих записей (spec §5, T3).
export async function deleteService(masterId, id, nowSec) {
  const related = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt, status: appointments.status })
    .from(appointments)
    .where(and(eq(appointments.masterId, masterId), eq(appointments.serviceId, id)))
    .all();

  const blocking = related.filter(
    (a) => (a.status === 'pending' || a.status === 'confirmed') && a.startsAt > nowSec,
  );
  if (blocking.length) return { ok: false, reason: 'HAS_FUTURE' };

  // Отвязать прошлые записи — иначе останутся висячие ссылки на удалённую услугу.
  await db
    .update(appointments)
    .set({ serviceId: null })
    .where(and(eq(appointments.masterId, masterId), eq(appointments.serviceId, id)))
    .run();
  await db
    .delete(services)
    .where(and(eq(services.masterId, masterId), eq(services.id, id)))
    .run();
  return { ok: true };
}

// Ручная сортировка «выше/ниже» (spec §5).
export async function moveService(masterId, id, dir) {
  const list = await listServices(masterId, { includeInactive: true });
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  const j = dir === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return false;
  const a = list[i], b = list[j];
  await updateService(masterId, a.id, { sort: b.sort });
  await updateService(masterId, b.id, { sort: a.sort });
  // Если сортировки совпали — перенумеровать весь список.
  if (a.sort === b.sort) {
    for (let k = 0; k < list.length; k++) {
      await updateService(masterId, list[k].id, { sort: (k + 1) * 10 });
    }
  }
  return true;
}

export function serviceLabel(s, fmt) {
  const price = fmt ? fmt.money(s.priceCents) : `${s.priceCents / 100} ₽`;
  return `${s.name} — ${s.durationMin} мин — ${s.priceFrom ? 'от ' : ''}${price}`;
}