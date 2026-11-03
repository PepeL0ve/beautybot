// lib/time.js — чистые функции дат/времени/таймзон. Без библиотек, только Intl.
// Соглашения: дата — 'YYYY-MM-DD' (локальная у мастера), минуты — int от
// полуночи локального дня, epoch — unix-секунды. weekday: 0=Пн … 6=Вс.

const fmtCache = new Map();

function dtf(tz, opts) {
  const key = tz + '|' + JSON.stringify(opts);
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

// Смещение таймзоны (в минутах, восток — плюс) в момент epochSec.
export function tzOffsetMin(tz, epochSec) {
  const d = new Date(epochSec * 1000);
  const p = Object.fromEntries(
    dtf(tz, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const asUTC = Date.UTC(
    +p.year, +p.month - 1, +p.day, (+p.hour) % 24, +p.minute, +p.second,
  );
  return Math.round((asUTC - d.getTime()) / 60000);
}

// Локальная дата 'YYYY-MM-DD' в момент epochSec.
export function localDate(tz, epochSec) {
  const p = Object.fromEntries(
    dtf(tz, { year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(epochSec * 1000)).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

// Локальные минуты от полуночи в момент epochSec.
export function localMin(tz, epochSec) {
  const p = Object.fromEntries(
    dtf(tz, { hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(epochSec * 1000)).map((x) => [x.type, x.value]),
  );
  return (+p.hour) % 24 * 60 + +p.minute;
}

// Локальное wall-время → epoch (двухпроходно, корректно на стыке DST).
export function zonedToEpoch(tz, dateStr, min) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const hh = Math.floor(min / 60), mm = min % 60;
  const naive = Date.UTC(y, m - 1, d, hh, mm) / 1000;
  let guess = naive - tzOffsetMin(tz, naive) * 60;
  guess = naive - tzOffsetMin(tz, guess) * 60;
  return Math.round(guess);
}

export function todayStr(tz, nowSec) {
  return localDate(tz, nowSec);
}

export function weekdayOf(dateStr) {
  const day = new Date(dateStr + 'T00:00:00Z').getUTCDay(); // 0=Вс
  return (day + 6) % 7; // 0=Пн
}

export function addDays(dateStr, n) {
  const t = new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diffDays(fromStr, toStr) {
  return Math.round(
    (new Date(toStr + 'T00:00:00Z') - new Date(fromStr + 'T00:00:00Z')) / 86400000,
  );
}

// [a1,a2) и [b1,b2) пересекаются?
export function overlaps(a1, a2, b1, b2) {
  return a1 < b2 && b1 < a2;
}

export function minToHHMM(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

export function hhmmToMin(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = +m[1], mm = +m[2];
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

export const WD_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

// '2026-11-05' → '5 ноября' (+ год, если не текущий по tz/now)
export function fmtDate(dateStr, { withYear = false, today = null } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WD_SHORT[weekdayOf(dateStr)];
  let s = `${d} ${MONTHS_GEN[m - 1]}`;
  if (withYear || (today && today.slice(0, 4) !== dateStr.slice(0, 4))) s += ` ${y}`;
  return `${s}, ${wd}`;
}

export function fmtDateTime(epochSec, tz) {
  const date = localDate(tz, epochSec);
  return `${fmtDate(date)} в ${minToHHMM(localMin(tz, epochSec))}`;
}

// Смещение в человекочитаемом виде для напоминаний: 1440 → 'за 24 ч', 120 → 'за 2 ч'
export function fmtOffset(min) {
  if (min % 1440 === 0 && min >= 1440) return `за ${min / 1440} дн.`;
  if (min % 60 === 0) return `за ${min / 60} ч`;
  return `за ${min} мин`;
}
