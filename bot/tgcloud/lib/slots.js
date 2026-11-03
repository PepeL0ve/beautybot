// lib/slots.js — чистый движок свободных окон (spec §7).
// Вход/выход — минуты локального дня и epoch; никаких обращений к БД.

import { overlaps, zonedToEpoch, localMin, localDate } from './time.js';

export const GRID_MIN = 15; // шаг сетки

/**
 * @param {object} p
 * @param {{startMin:number,endMin:number}|null} p.work  рабочий интервал дня (null = выходной)
 * @param {Array<{startMin:number|null,endMin:number|null}>} p.timeOff  startMin=null → весь день
 * @param {Array<{startEpoch:number,endEpoch:number}>} p.busy  активные записи дня
 * @param {number} p.durationMin  длительность услуги (мин)
 * @param {number} p.stickyMin    буфер вокруг записей («липкие окна»)
 * @param {number} p.minLeadSec   минимальный горизонт записи (сек от «сейчас»)
 * @param {number} p.nowSec       текущее unix-время
 * @param {string} p.tz
 * @param {string} p.dateStr      локальная дата дня 'YYYY-MM-DD'
 * @returns {Array<{min:number,epoch:number}>} начала свободных окон по возрастанию
 */
export function computeSlots(p) {
  const { work, timeOff, busy, durationMin, stickyMin, minLeadSec, nowSec, tz, dateStr } = p;
  if (!work || durationMin <= 0) return [];
  if (timeOff.some((t) => t.startMin == null)) return []; // день занят целиком

  const pad = Math.max(0, stickyMin | 0);
  const blocked = [
    ...timeOff.map((t) => ({ a: t.startMin, b: t.endMin })),
    ...busy.map((b) => ({
      a: clampDayMin(tz, dateStr, b.startEpoch) - pad,
      b: clampDayMin(tz, dateStr, b.endEpoch) + pad,
    })),
  ];

  const earliestEpoch = nowSec + Math.max(0, minLeadSec);
  const out = [];
  for (let t = work.startMin; t + durationMin <= work.endMin; t += GRID_MIN) {
    const end = t + durationMin;
    if (zonedToEpoch(tz, dateStr, t) < earliestEpoch) continue;
    if (blocked.some((x) => overlaps(t, end, x.a, x.b))) continue;
    out.push({ min: t, epoch: zonedToEpoch(tz, dateStr, t) });
  }
  return out;
}

// Минуты epoch-момента в рамках ЛОКАЛЬНОГО дня dateStr (0..1440):
// моменты соседних дней прижимаются к границе дня.
function clampDayMin(tz, dateStr, epochSec) {
  const d = localDate(tz, epochSec);
  if (d === dateStr) return localMin(tz, epochSec);
  return d < dateStr ? 0 : 1440;
}
