// lib/svc/schedule.js — работа с расписанием и слотами поверх БД.

import { db } from 'sdk';
import { and, eq, gte, lt, inArray } from 'sdk/db';
import { workHours, timeOff, appointments } from '../../schema.js';
import { computeSlots } from '../slots.js';
import { weekdayOf, addDays, zonedToEpoch } from '../time.js';

// Активные записи мастера, пересекающие локальный день dateStr.
export async function busyForDay(masterId, dateStr, tz) {
  const dayStart = zonedToEpoch(tz, dateStr, 0);
  const dayEnd = zonedToEpoch(tz, addDays(dateStr, 1), 0);
  return db
    .select({ startEpoch: appointments.startsAt, endEpoch: appointments.endsAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.masterId, masterId),
        inArray(appointments.status, ['pending', 'confirmed', 'completed']),
        lt(appointments.startsAt, dayEnd),
        gte(appointments.endsAt, dayStart),
      ),
    )
    .all();
}

// Свободные окна мастера на дату под услугу длительностью durationMin.
export async function slotsForDate(master, dateStr, durationMin, nowSec) {
  const tz = master.timezone;
  const wh = await db
    .select()
    .from(workHours)
    .where(and(eq(workHours.masterId, master.id), eq(workHours.weekday, weekdayOf(dateStr))))
    .get();
  const toff = await db
    .select()
    .from(timeOff)
    .where(and(eq(timeOff.masterId, master.id), eq(timeOff.date, dateStr)))
    .all();
  const busy = await busyForDay(master.id, dateStr, tz);
  const s = master.settings || {};
  return computeSlots({
    work: wh && wh.enabled ? { startMin: wh.startMin, endMin: wh.endMin } : null,
    timeOff: toff,
    busy,
    durationMin,
    stickyMin: s.sticky_min ?? 0,
    minLeadSec: (s.min_lead_min ?? 60) * 60,
    nowSec,
    tz,
    dateStr,
  });
}

// Число «пробных» окон (по умолчанию 30 мин) на дату — для сводок день/неделя.
export async function freeCountForDay(master, dateStr, nowSec, probeMin = 30) {
  const slots = await slotsForDate(master, dateStr, probeMin, nowSec);
  return slots.length;
}
