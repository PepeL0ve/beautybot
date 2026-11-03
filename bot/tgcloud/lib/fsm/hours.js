// lib/fsm/hours.js — диалоги расписания: дни, время-оф, шаблоны (spec §6).

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import {
  fsmRow, scheduleMenu, dayMenu, timeOffKindMenu, timeOffMenu, templatesMenu,
  WD_LABELS,
} from '../kb.js';
import { getState, setState, clearState } from '../state.js';
import { esc } from '../fmt.js';
import { hhmmToMin, minToHHMM, fmtDate, localDate, addDays } from '../time.js';
import {
  getWorkHours, setWorkDay, toggleWorkDay, addTimeOff, removeTimeOff,
  listTimeOff, listTemplates, saveCurrentAsTemplate, applyTemplate, timeOffLabel,
  ensurePresetTemplate,
} from '../svc/hours.js';

const DAY_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

export async function showSchedule(chatId, master) {
  await ensurePresetTemplate(master.id);
  const hours = await getWorkHours(master.id);
  const summary = [0, 1, 2, 3, 4, 5, 6].map((wd) => {
    const row = hours.find((r) => r.weekday === wd);
    if (!row || !row.enabled) return `${WD_LABELS[wd]} — выходной`;
    return `${WD_LABELS[wd]} — ${minToHHMM(row.startMin)}–${minToHHMM(row.endMin)}`;
  }).join('\n');
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: T.SCH_TITLE(summary),
    reply_markup: scheduleMenu(hours),
  });
}

export async function showDay(chatId, master, wd) {
  const hours = await getWorkHours(master.id);
  const row = hours.find((r) => r.weekday === wd);
  const on = !!(row && row.enabled);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: `🗓 <b>${DAY_FULL[wd]}</b>\n\n${on ? `${minToHHMM(row.startMin)} – ${minToHHMM(row.endMin)}` : 'выходной'}`,
    reply_markup: dayMenu(wd, on),
  });
}

export async function showTimeOff(chatId, master, nowSec) {
  const today = localDate(master.timezone, nowSec);
  const rows = await listTimeOff(master.id, today, addDays(today, 14));
  const lines = rows.length
    ? rows.map((r) => `${fmtDate(r.date)} — ${timeOffLabel(r)}`)
    : [];
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: rows.length ? T.SCH_TIMEOFF_TITLE(lines) : T.SCH_TIMEOFF_EMPTY,
    reply_markup: timeOffMenu(rows),
  });
}

export async function showTemplates(chatId, master) {
  await ensurePresetTemplate(master.id);
  const rows = await listTemplates(master.id);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: rows.length ? T.SCH_TPL_TITLE(rows.map((t) => `📐 ${esc(t.name)}`)) : T.SCH_TPL_EMPTY,
    reply_markup: templatesMenu(rows),
  });
}

// --- ввод текстом ---

export async function hoursTextInput(chatId, userId, state, text, master) {
  const d = state.data || {};

  if (state.state === 'sch:start' || state.state === 'sch:end') {
    const min = hhmmToMin(text);
    if (min == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_BAD_TIME }));
    }
    const hours = await getWorkHours(master.id);
    const row = hours.find((r) => r.weekday === d.wd);
    const start = state.state === 'sch:start' ? min : (row?.startMin ?? 600);
    const end = state.state === 'sch:end' ? min : (row?.endMin ?? 1140);
    if (end <= start) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_BAD_RANGE }));
    }
    await setWorkDay(master.id, d.wd, { startMin: start, endMin: end, enabled: true });
    await clearState(chatId);
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.SCH_SAVED_DAY(DAY_FULL[d.wd], minToHHMM(start), minToHHMM(end)),
    });
    return void (await showSchedule(chatId, master));
  }

  if (state.state === 'toff:start' || state.state === 'toff:end') {
    const min = hhmmToMin(text);
    if (min == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_BAD_TIME }));
    }
    if (state.state === 'toff:start') {
      await setState(chatId, userId, 'toff:end', { ...d, startMin: min });
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_ASK_END(minToHHMM(min)) }));
    }
    if (min <= d.startMin) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_BAD_RANGE }));
    }
    const created = await addTimeOff(master.id, {
      date: d.date, startMin: d.startMin, endMin: min, kind: d.kind || 'break', note: null,
    });
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_ADDED(timeOffLabel(created)) });
    const nowSec = Math.floor(Date.now() / 1000);
    return void (await showTimeOff(chatId, master, nowSec));
  }

  if (state.state === 'toff:note') {
    const note = text === '-' ? null : text.slice(0, 60);
    const created = await addTimeOff(master.id, {
      date: d.date, startMin: d.startMin, endMin: d.endMin, kind: d.kind, note,
    });
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_ADDED(timeOffLabel(created)) });
    const nowSec = Math.floor(Date.now() / 1000);
    return void (await showTimeOff(chatId, master, nowSec));
  }

  if (state.state === 'tpl:name') {
    const tpl = await saveCurrentAsTemplate(master.id, text);
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TPL_SAVED(tpl.name) });
    return void (await showTemplates(chatId, master));
  }
  return false;
}

// --- кнопки ---

export async function schCallback(cq, action, arg, master) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const nowSec = Math.floor(Date.now() / 1000);

  if (action === 'day') {
    return void (await showDay(chatId, master, Number(arg)));
  }
  if (action === 'tg') {
    await toggleWorkDay(master.id, Number(arg));
    return void (await showDay(chatId, master, Number(arg)));
  }
  if (action === 'st' || action === 'en') {
    const wd = Number(arg);
    await setState(chatId, userId, action === 'st' ? 'sch:start' : 'sch:end', { wd });
    const prompt = action === 'st' ? T.SCH_ASK_START(DAY_FULL[wd]) : T.SCH_ASK_END(DAY_FULL[wd], '—');
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: prompt, reply_markup: fsmRow('sch') }));
  }

  if (action === 'off') return void (await showTimeOff(chatId, master, nowSec));
  if (action === 'oa') {
    // arg === '-' → показать выбор даты; arg === 'YYYY-MM-DD' → выбор вида.
    if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      await setState(chatId, userId, 'toff:kind', { date: arg });
      return void (await api.sendMessage({
        chat_id: chatId, parse_mode: 'HTML',
        text: `${fmtDate(arg)}\n\n${T.SCH_TOFF_KIND}`,
        reply_markup: timeOffKindMenu(),
      }));
    }
    const today = localDate(master.timezone, nowSec);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: '📆 На какую дату добавить перерыв/выходной?',
      reply_markup: {
        inline_keyboard: dates.map((dt) => [{ text: fmtDate(dt), callback_data: `sch:oa:${dt}` }])
          .concat([[{ text: '❌ Отмена', callback_data: 'fsm:cancel:toff' }]]),
      },
    }));
  }
  if (action === 'ok') {
    // arg = вид; дата берётся из state
    const st = await getState(chatId);
    const date = st?.data?.date;
    if (!date) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    if (arg === 'dayoff') {
      const created = await addTimeOff(master.id, { date, startMin: null, endMin: null, kind: 'dayoff', note: null });
      await clearState(chatId);
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_ADDED(timeOffLabel(created)) });
      return void (await showTimeOff(chatId, master, nowSec));
    }
    await setState(chatId, userId, 'toff:start', { date, kind: arg });
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_ASK_START, reply_markup: fsmRow('toff') }));
  }
  if (action === 'od') {
    await removeTimeOff(master.id, Number(arg));
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TOFF_DELETED });
    return void (await showTimeOff(chatId, master, nowSec));
  }

  if (action === 'tp') return void (await showTemplates(chatId, master));
  if (action === 'ts') {
    await setState(chatId, userId, 'tpl:name', {});
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TPL_ASK_NAME, reply_markup: fsmRow('sch') }));
  }
  if (action === 'ta') {
    const tpls = await listTemplates(master.id);
    const tpl = tpls.find((t) => t.id === Number(arg));
    const ok = await applyTemplate(master.id, Number(arg));
    if (!ok) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SCH_TPL_APPLIED(tpl?.name || '') });
    return void (await showSchedule(chatId, master));
  }
}