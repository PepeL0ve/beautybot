// lib/fsm/appointments.js — диалоги записей: создание, перенос, статусы (spec §8).
// Формат callback_data: ap:<action>:<arg>, где arg может быть составным
// («<id>:<date>», «<id>:<min>»); роутер в handlers разбирает остаток целиком.

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import {
  fsmRow, clientsPickMenu, servicesPickMenu, datesMenu, slotsMenu,
  moveDatesMenu, moveSlotsMenu, ap as AP,
} from '../kb.js';
import { getState, setState, clearState } from '../state.js';
import { money, parseMoney } from '../fmt.js';
import { fmtDate, localDate, hhmmToMin } from '../time.js';
import {
  createAppointment, getAppointment, setStatus, togglePrepaid, setPrice, setNote,
  moveAppointment, deleteAppointment, enrich, apDate,
} from '../svc/appointments.js';
import { slotsForDate } from '../svc/schedule.js';
import { listServices, getService } from '../svc/services.js';
import { searchClients, createClient, listClients } from '../svc/clients.js';
import {
  dayScreen, weekScreen, appointmentCard, nextDateOptions, dateLabel, slotLabel, statusLabel,
} from '../svc/render.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------- Экраны ----------

export async function showDay(chatId, master, dateStr, nowSec) {
  const sc = await dayScreen(master, dateStr, nowSec);
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: sc.text, reply_markup: sc.markup });
}

export async function showWeek(chatId, master, fromDate, nowSec) {
  const sc = await weekScreen(master, fromDate, nowSec);
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: sc.text, reply_markup: sc.markup });
}

export async function showCard(chatId, master, apId) {
  const raw = await getAppointment(master.id, apId);
  if (!raw) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const [ap] = await enrich(master.id, [raw]);
  const card = await appointmentCard(master, ap);
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup });
}

// ---------- Создание записи (FSM) ----------

export async function startAdd(chatId, userId, master, preselectedClientId = null) {
  if (preselectedClientId) {
    // Запись начинается из карточки клиента — клиент уже известен.
    return void (await askService(chatId, userId, { clientId: preselectedClientId }, master));
  }
  const clients = await listClients(master.id);
  await setState(chatId, userId, 'ap:client', { draft: {} });
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: T.AP_ASK_CLIENT,
    reply_markup: clientsPickMenu(clients.slice(0, 8)),
  });
}

async function askService(chatId, userId, draft, master) {
  const svcs = await listServices(master.id);
  if (!svcs.length) {
    await clearState(chatId);
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_LIST_EMPTY }));
  }
  await setState(chatId, userId, 'ap:service', { draft });
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_SERVICE, reply_markup: servicesPickMenu(svcs),
  });
}

async function askDate(chatId, userId, draft, master, nowSec) {
  await setState(chatId, userId, 'ap:date', { draft });
  const dates = nextDateOptions(master.timezone, nowSec, 7);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_DATE, reply_markup: datesMenu(dates, dateLabel),
  });
}

async function askTime(chatId, userId, draft, master, nowSec) {
  const svc = await getService(master.id, draft.serviceId);
  const slots = await slotsForDate(master, draft.dateStr, svc.durationMin, nowSec);
  await setState(chatId, userId, 'ap:time', { draft });
  if (!slots.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_NO_SLOTS }));
  }
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: `${T.AP_ASK_TIME}\n\n🕳 Свободно: ${slots.length}`,
    reply_markup: slotsMenu(slots, slotLabel),
  });
}

async function finishCreate(chatId, userId, draft, priceCents, master, nowSec) {
  const res = await createAppointment(master, {
    clientId: draft.clientId,
    serviceId: draft.serviceId,
    dateStr: draft.dateStr,
    startMin: draft.startMin,
    priceCents: priceCents ?? undefined,
    status: 'confirmed',
    source: 'master',
  }, nowSec);
  await clearState(chatId);

  if (!res.ok) {
    const text = res.reason === 'CONFLICT' ? T.AP_CONFLICT : T.ERR;
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text }));
  }

  const [ap] = await enrich(master.id, [res.appointment]);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: T.AP_CREATED({
      ...ap,
      clientName: ap.client?.displayName,
      serviceName: ap.service?.name,
    }, master.timezone, money(ap.priceCents)),
  });
  const card = await appointmentCard(master, ap);
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup });
}

// Длительность выбрана → цена (если «от») или сразу создание.
async function onTimeChosen(chatId, userId, draft, master, nowSec) {
  const svc = await getService(master.id, draft.serviceId);
  if (svc?.priceFrom) {
    await setState(chatId, userId, 'ap:price', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.AP_ASK_PRICE(svc.name, money(svc.priceCents)),
      reply_markup: fsmRow('ap-new'),
    }));
  }
  return void (await finishCreate(chatId, userId, draft, null, master, nowSec));
}

async function askMoveDate(chatId, master, apId, nowSec) {
  const dates = nextDateOptions(master.timezone, nowSec, 7);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: T.AP_ASK_MOVE_DATE, reply_markup: moveDatesMenu(apId, dates, dateLabel),
  });
}

async function askMoveTime(chatId, userId, apId, dateStr, master, nowSec) {
  const raw = await getAppointment(master.id, apId);
  if (!raw) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const durationMin = Math.round((raw.endsAt - raw.startsAt) / 60);
  const slots = await slotsForDate(master, dateStr, durationMin, nowSec);
  await setState(chatId, userId, 'ap:move_time', { draft: { apId, dateStr } });
  if (!slots.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_NO_SLOTS }));
  }
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: `${fmtDate(dateStr)}\n\n${T.AP_ASK_MOVE_TIME}`,
    reply_markup: moveSlotsMenu(apId, slots, slotLabel),
  });
}

async function doMove(chatId, userId, apId, dateStr, startMin, master) {
  const res = await moveAppointment(master, apId, dateStr, startMin);
  await clearState(chatId);
  if (!res.ok) {
    const text = res.reason === 'CONFLICT' ? T.AP_CONFLICT : T.ERR;
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text }));
  }
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_MOVED });
  await showCard(chatId, master, apId);
}

// ---------- Ввод текстом ----------

export async function apTextInput(chatId, userId, state, text, master, nowSec) {
  const draft = state.data?.draft || {};

  if (state.state === 'ap:client') {
    const found = await searchClients(master.id, text);
    if (found.length === 1) {
      return void (await askService(chatId, userId, { ...draft, clientId: found[0].id }, master));
    }
    if (found.length > 1) {
      return void (await api.sendMessage({
        chat_id: chatId, parse_mode: 'HTML',
        text: 'Нашёл нескольких — выберите:', reply_markup: clientsPickMenu(found),
      }));
    }
    await setState(chatId, userId, 'ap:client_name', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.AP_NEW_CLIENT_NAME, reply_markup: fsmRow('ap-new'),
    }));
  }

  if (state.state === 'ap:client_name') {
    draft.clientName = text.slice(0, 80);
    await setState(chatId, userId, 'ap:client_phone', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_CLIENT_PHONE, reply_markup: fsmRow('ap-new'),
    }));
  }

  if (state.state === 'ap:client_phone') {
    const phone = text === '-' ? null : text.slice(0, 32);
    const client = await createClient(master.id, { displayName: draft.clientName, phone });
    return void (await askService(chatId, userId, { ...draft, clientId: client.id }, master));
  }

  if (state.state === 'ap:time') {
    const min = hhmmToMin(text);
    if (min == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_BAD_TIME }));
    }
    return void (await onTimeChosen(chatId, userId, { ...draft, startMin: min }, master, nowSec));
  }

  if (state.state === 'ap:price') {
    const cents = text === '-' ? null : parseMoney(text);
    if (text !== '-' && cents == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE_BAD }));
    }
    return void (await finishCreate(chatId, userId, draft, cents, master, nowSec));
  }

  if (state.state === 'ap:price_edit') {
    if (text === '-') return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE_BAD }));
    const cents = parseMoney(text);
    if (cents == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE_BAD }));
    }
    const apId = draft.apId;
    await setPrice(master.id, apId, cents);
    await clearState(chatId);
    return void (await showCard(chatId, master, apId));
  }

  if (state.state === 'ap:move') {
    if (!DATE_RE.test(text.trim())) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_MOVE_DATE }));
    }
    return void (await askMoveTime(chatId, userId, draft.apId, text.trim(), master, nowSec));
  }

  if (state.state === 'ap:move_time') {
    const min = hhmmToMin(text);
    if (min == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_BAD_TIME }));
    }
    return void (await doMove(chatId, userId, draft.apId, draft.dateStr, min, master));
  }

  if (state.state === 'ap:note') {
    await setNote(master.id, draft.apId, text === '-' ? null : text);
    await clearState(chatId);
    return void (await showCard(chatId, master, draft.apId));
  }
  return false;
}

// ---------- Кнопки ----------
// arg приходит целиком (роутер склеивает части после второго ':').

export async function apCallback(cq, action, arg, master, nowSec) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const parts = String(arg ?? '').split(':');
  const id = Number(parts[0]);

  // Экраны
  if (action === 'day') {
    const dateStr = arg === '0' ? localDate(master.timezone, nowSec) : String(arg);
    return void (await showDay(chatId, master, dateStr, nowSec));
  }
  if (action === 'wk') return void (await showWeek(chatId, master, localDate(master.timezone, nowSec), nowSec));
  if (action === 'add') return void (await startAdd(chatId, userId, master));

  // Новый диалог: клиент / услуга / дата / время
  if (action === 'cn') {
    await setState(chatId, userId, 'ap:client_name', { draft: {} });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.AP_NEW_CLIENT_NAME, reply_markup: fsmRow('ap-new'),
    }));
  }
  if (action === 'cp') {
    const st = await getState(chatId);
    if (!st || st.state !== 'ap:client') return;
    return void (await askService(chatId, userId, { ...st.data.draft, clientId: id }, master));
  }
  if (action === 'sp') {
    const st = await getState(chatId);
    if (!st || st.state !== 'ap:service') return;
    return void (await askDate(chatId, userId, { ...st.data.draft, serviceId: id }, master, nowSec));
  }
  if (action === 'dp') {
    const st = await getState(chatId);
    if (!st || st.state !== 'ap:date') return;
    if (!DATE_RE.test(String(arg))) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_DATE }));
    }
    return void (await askTime(chatId, userId, { ...st.data.draft, dateStr: String(arg) }, master, nowSec));
  }
  if (action === 'tp') {
    const st = await getState(chatId);
    if (!st || st.state !== 'ap:time') return;
    return void (await onTimeChosen(chatId, userId, { ...st.data.draft, startMin: id }, master, nowSec));
  }

  // Карточка записи
  if (action === 'op') return void (await showCard(chatId, master, id));

  if (action === 'st') {
    const status = parts[1];
    const res = await setStatus(master.id, id, status, nowSec);
    if (!res.ok) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_STATUS_SET(statusLabel(status)) });
    return void (await showCard(chatId, master, id));
  }

  if (action === 'pp') {
    const updated = await togglePrepaid(master.id, id);
    if (!updated) return;
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: updated.prepaid ? T.AP_PREPAID_ON : T.AP_PREPAID_OFF,
    });
    return void (await showCard(chatId, master, id));
  }

  if (action === 'pc') {
    await setState(chatId, userId, 'ap:price_edit', { draft: { apId: id } });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: '💰 Новая цена записи в рублях:', reply_markup: fsmRow('ap'),
    }));
  }

  if (action === 'nt') {
    await setState(chatId, userId, 'ap:note', { draft: { apId: id } });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.AP_ASK_NOTE, reply_markup: fsmRow('ap'),
    }));
  }

  // Перенос: ap:mv:<id> → выбор даты; ap:md:<id>:<date> → слоты; ap:ms:<id>:<min> → выполнить
  if (action === 'mv') return void (await askMoveDate(chatId, master, id, nowSec));
  if (action === 'md') return void (await askMoveTime(chatId, userId, id, parts[1], master, nowSec));
  if (action === 'ms') {
    const st = await getState(chatId);
    const dateStr = st?.data?.draft?.dateStr;
    if (!dateStr) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    return void (await doMove(chatId, userId, id, dateStr, Number(parts[1]), master));
  }

  if (action === 'dl') {
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: '🗑 Удалить запись? Действие необратимо.',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Удалить', callback_data: AP.delConfirm(id) },
          { text: '❌ Нет', callback_data: AP.open(id) },
        ]],
      },
    }));
  }
  if (action === 'dy') {
    const raw = await getAppointment(master.id, id);
    await deleteAppointment(master.id, id);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_DELETED });
    if (raw) return void (await showDay(chatId, master, apDate(raw, master.timezone), nowSec));
  }
}