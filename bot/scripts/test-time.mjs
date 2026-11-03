// Локальные проверки lib/time.js и lib/slots.js (чистые модули, без SDK).
// Запуск из bot/: node scripts/test-time.mjs

import assert from 'node:assert/strict';
import {
  tzOffsetMin, localDate, localMin, zonedToEpoch, weekdayOf, addDays,
  diffDays, minToHHMM, hhmmToMin, overlaps, fmtDate,
} from '../tgcloud/lib/time.js';
import { computeSlots } from '../tgcloud/lib/slots.js';

let n = 0;
const ok = (name) => (n++, console.log(`  ✓ ${name}`));

// --- таймзоны ---
assert.equal(tzOffsetMin('Europe/Moscow', 0), 180); // MSK стабильно +3
ok('tzOffsetMin Moscow +3');

// 2026-11-05 10:00 MSK == 07:00 UTC
const e1 = zonedToEpoch('Europe/Moscow', '2026-11-05', 600);
assert.equal(new Date(e1 * 1000).toISOString(), '2026-11-05T07:00:00.000Z');
ok('zonedToEpoch Moscow 10:00 → 07:00Z');

// DST: Берлин зима +60, лето +120
const w = zonedToEpoch('Europe/Berlin', '2026-01-15', 600);
const s = zonedToEpoch('Europe/Berlin', '2026-07-15', 600);
assert.equal(new Date(w * 1000).toISOString(), '2026-01-15T09:00:00.000Z');
assert.equal(new Date(s * 1000).toISOString(), '2026-07-15T08:00:00.000Z');
ok('zonedToEpoch DST Berlin');

// локальная дата/минуты через полночь: 2026-11-05 00:30 MSK = 2026-11-04 21:30Z
const e2 = Date.UTC(2026, 10, 4, 21, 30) / 1000;
assert.equal(localDate('Europe/Moscow', e2), '2026-11-05');
assert.equal(localMin('Europe/Moscow', e2), 30);
ok('localDate/localMin across midnight');

// UTC+5: 2026-11-05 10:00 локально = 05:00Z
const e3 = zonedToEpoch('Asia/Yekaterinburg', '2026-11-05', 600);
assert.equal(new Date(e3 * 1000).toISOString(), '2026-11-05T05:00:00.000Z');
ok('T18 UTC+5 slot base');

// --- календарика ---
assert.equal(weekdayOf('2026-11-03'), 1); // вторник
assert.equal(weekdayOf('2026-11-02'), 0); // понедельник
assert.equal(weekdayOf('2026-11-01'), 6); // воскресенье
assert.equal(addDays('2026-10-31', 2), '2026-11-02');
assert.equal(addDays('2027-01-01', -1), '2026-12-31');
assert.equal(diffDays('2026-11-01', '2026-11-14'), 13);
ok('weekdayOf/addDays/diffDays');

assert.equal(minToHHMM(600), '10:00');
assert.equal(minToHHMM(1125), '18:45');
assert.equal(hhmmToMin('9:05'), 545);
assert.equal(hhmmToMin('25:00'), null);
assert.equal(hhmmToMin('abc'), null);
assert.equal(overlaps(600, 660, 660, 720), false); // впритык — не пересечение
assert.equal(overlaps(600, 660, 659, 720), true);
assert.match(fmtDate('2026-11-05'), /5 ноября, Чт/);
ok('форматы и интервалы');

// --- движок слотов ---
const base = {
  tz: 'Europe/Moscow', dateStr: '2026-11-05',
  nowSec: Date.UTC(2026, 10, 4, 12, 0) / 1000, // сутки до
  minLeadSec: 3600, stickyMin: 0, timeOff: [],
};

const work = { startMin: 600, endMin: 1140 }; // 10:00–19:00

// T4: услуга 60 мин, пустой день → 10:00…18:00 (33 слота)
let slots = computeSlots({ ...base, work, busy: [], durationMin: 60 });
assert.equal(slots.length, 33);
assert.equal(slots[0].min, 600);
assert.equal(slots.at(-1).min, 1080);
ok('T4 пустой день 10:00–18:00');

// занятость 11:00–12:00 (MSK) — перекрытия 10:15…10:45 блокируются, 10:00 и 12:00 валидны
const busyEpoch = {
  startEpoch: zonedToEpoch('Europe/Moscow', '2026-11-05', 660),
  endEpoch: zonedToEpoch('Europe/Moscow', '2026-11-05', 720),
};
slots = computeSlots({ ...base, work, busy: [busyEpoch], durationMin: 60 });
assert.ok(slots.some((s) => s.min === 600), '10:00 разрешён (впритык)');
assert.ok(!slots.some((s) => s.min > 600 && s.min < 720), '10:15–11:45 блокированы');
assert.ok(slots.some((s) => s.min === 720), '12:00 разрешён');
ok('T5 пересечение/впритык');

// T4b: sticky 15 мин вокруг записи 11:00–12:00 → запрет [10:45–12:15],
// первый валидный старт 12:15 (слот [12:15,13:15) не задевает буфер)
slots = computeSlots({ ...base, work, busy: [busyEpoch], durationMin: 60, stickyMin: 15 });
assert.ok(!slots.some((s) => s.min <= 720));
assert.equal(slots[0].min, 735);
ok('T4b sticky_min=15');

// min_lead: сейчас 08:00 локально дня записи, lead 60 мин → слоты с 09:00… но услуга 60 мин и работа с 10:00 → 10:00
const nowSameDay = zonedToEpoch('Europe/Moscow', '2026-11-05', 480);
slots = computeSlots({ ...base, nowSec: nowSameDay, work, busy: [], durationMin: 60 });
assert.equal(slots[0].min, 600);
// а при 10:30 текущего времени первый слот 11:30 (горизонт lead 60 мин: 11:00 — слишком срочно)
const now1030 = zonedToEpoch('Europe/Moscow', '2026-11-05', 630);
slots = computeSlots({ ...base, nowSec: now1030, work, busy: [], durationMin: 60 });
assert.equal(slots[0].min, 690);
ok('min_lead/горизонт');

// T6: весь день занят
slots = computeSlots({ ...base, work, timeOff: [{ startMin: null, endMin: null }], busy: [], durationMin: 60 });
assert.deepEqual(slots, []);
// перерыв 13:00–14:00 при 30-мин услуге: старты ≤12:30 и ≥14:00 — ок
slots = computeSlots({ ...base, work, timeOff: [{ startMin: 780, endMin: 840 }], busy: [], durationMin: 30 });
assert.ok(!slots.some((s) => s.min > 750 && s.min < 840), '12:45–13:45 блокированы');
assert.ok(slots.some((s) => s.min === 750), '12:30 впритык к перерыву — ок');
assert.ok(slots.some((s) => s.min === 840));
ok('T6 time_off');

// выходной (work=null) и услуга длиннее дня
assert.deepEqual(computeSlots({ ...base, work: null, busy: [], durationMin: 60 }), []);
assert.deepEqual(computeSlots({ ...base, work, busy: [], durationMin: 700 }), []);
ok('выходной/длинная услуга');

console.log(`\nВсе проверки пройдены: ${n} групп ✓`);
