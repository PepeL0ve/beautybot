// lib/svc/render.js — сборка экранов «текст + клавиатура» для Фазы 1.

import { T } from '../i18n/ru.js';
import * as KB from '../kb.js';
import { money, esc } from '../fmt.js';
import {
  fmtDate, localDate, minToHHMM, addDays, weekdayOf, zonedToEpoch, WD_SHORT,
} from '../time.js';
import { listServices } from './services.js';
import { getWorkHours, weekSummary, listTimeOff, listTemplates, timeOffLabel } from './hours.js';
import {
  dayAppointments, rangeAppointments, enrich, apTime, apDate, STATUS_LABEL,
} from './appointments.js';
import { freeCountForDay } from './schedule.js';

// ---------- Услуги ----------

export async function servicesScreen(master) {
  const rows = await listServices(master.id, { includeInactive: true });
  if (!rows.length) {
    return { text: T.SVC_LIST_EMPTY, markup: KB.servicesMenu([]) };
  }
  return { text: T.SVC_LIST([]), markup: KB.servicesMenu(rows) };
}

export function serviceCard(s) {
  return {
    text: T.SVC_CARD(s, money(s.priceCents)),
    markup: KB.serviceCardMenu(s),
  };
}

// ---------- Расписание ----------

export async function scheduleScreen(master) {
  const hours = await getWorkHours(master.id);
  return { text: T.SCH_TITLE(weekSummary(hours)), markup: KB.scheduleMenu(hours) };
}

export async function dayScheduleScreen(master, wd) {
  const hours = await getWorkHours(master.id);
  const row = hours.find((r) => r.weekday === wd);
  const label = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'][wd];
  const body = row && row.enabled
    ? `${minToHHMM(row.startMin)} – ${minToHHMM(row.endMin)}`
    : 'выходной';
  return {
    text: `🗓 <b>${label}</b>\n\n${body}`,
    markup: KB.dayMenu(wd, !!(row && row.enabled)),
  };
}

export async function timeOffScreen(master, nowSec) {
  const tz = master.timezone;
  const today = localDate(tz, nowSec);
  const rows = await listTimeOff(master.id, today, addDays(today, 14));
  if (!rows.length) {
    return {
      text: T.SCH_TIMEOFF_EMPTY,
      markup: KB.timeOffMenu([]),
    };
  }
  const lines = rows.map((r) => `${fmtDate(r.date)} — ${timeOffLabel(r)}`);
  return { text: T.SCH_TIMEOFF_TITLE(lines), markup: KB.timeOffMenu(rows) };
}

export async function templatesScreen(master) {
  const rows = await listTemplates(master.id);
  if (!rows.length) {
    return { text: T.SCH_TPL_EMPTY, markup: KB.templatesMenu([]) };
  }
  return {
    text: T.SCH_TPL_TITLE(rows.map((t) => `📐 ${t.name}`)),
    markup: KB.templatesMenu(rows),
  };
}

// ---------- Записи ----------

function briefAp(a, tz) {
  return {
    id: a.id,
    time: apTime(a, tz),
    clientName: a.client?.displayName || 'Клиент',
    serviceName: a.service?.name || '',
    status: a.status,
    dateStr: apDate(a, tz),
  };
}

export async function dayScreen(master, dateStr, nowSec) {
  const tz = master.timezone;
  const rows = await enrich(master.id, await dayAppointments(master.id, tz, dateStr));
  const free = await freeCountForDay(master, dateStr, nowSec);
  const title = fmtDate(dateStr);
  if (!rows.length) {
    return {
      text: T.AP_DAY_TITLE(title, ['Записей нет.'], free),
      markup: KB.appointmentsMenu(dateStr, []),
    };
  }
  const lines = rows.map((a) => {
    const mark = { pending: '⏳', confirmed: '✅', completed: '✔️', canceled: '❌', no_show: '🚫' }[a.status] || '•';
    const svcName = a.service?.name ? ` · ${esc(a.service.name)}` : '';
    return `${mark} <b>${apTime(a, tz)}</b> ${esc(a.client?.displayName || 'Клиент')}${svcName}`;
  });
  return {
    text: T.AP_DAY_TITLE(title, lines, free),
    markup: KB.appointmentsMenu(dateStr, rows.map((a) => briefAp(a, tz))),
  };
}

export async function weekScreen(master, fromDate, nowSec) {
  const tz = master.timezone;
  const toDate = addDays(fromDate, 6);
  const rows = await enrich(master.id, await rangeAppointments(master.id, tz, fromDate, toDate));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(fromDate, i);
    const dayRows = rows.filter((a) => apDate(a, tz) === date);
    const active = dayRows.filter((a) => a.status === 'pending' || a.status === 'confirmed');
    days.push({
      date,
      label: `${WD_SHORT[weekdayOf(date)]} ${Number(date.slice(8))}.${date.slice(5, 7)} · ${active.length}`,
      count: active.length,
    });
  }
  const lines = days.map((d) => {
    const dayRows = rows.filter((a) => apDate(a, tz) === d.date);
    const active = dayRows.filter((a) => a.status === 'pending' || a.status === 'confirmed');
    return `${esc(fmtDate(d.date))} — ${active.length === 0 ? 'свободно' : `${active.length} зап.`}`;
  });
  return { text: T.AP_WEEK_TITLE(lines), markup: KB.weekMenu(days) };
}

export async function appointmentCard(master, a) {
  const tz = master.timezone;
  const view = {
    ...a,
    clientName: a.client?.displayName,
    serviceName: a.service?.name,
    dateStr: apDate(a, tz),
  };
  return {
    text: T.AP_CARD(a, tz, money(a.priceCents)),
    markup: KB.appointmentCardMenu(view),
  };
}

export function statusLabel(status) {
  return STATUS_LABEL[status] || status;
}

// ---------- Выбор даты/слотов ----------

export function nextDateOptions(tz, nowSec, count = 7) {
  const today = localDate(tz, nowSec);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

export function dateLabel(date) {
  return fmtDate(date);
}

export function slotLabel(min) {
  return minToHHMM(min);
}

export { zonedToEpoch };