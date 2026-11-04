// handlers/callback_query.js — единый роутер инлайн-кнопок (spec §1).
// callback_data: '<area>:<action>:<arg>', где arg может сам содержать ':'.

import { api } from 'sdk';
import { T } from '../lib/i18n/ru.js';
import { mainMenu, TZ_OPTIONS } from '../lib/kb.js';
import { getMasterByTg } from '../lib/access.js';
import { getState, clearState } from '../lib/state.js';
import { bookLink } from '../lib/botinfo.js';
import { finishOnboarding, onboardingName } from '../lib/svc/onboarding.js';
import { showServices, svcCallback } from '../lib/fsm/services.js';
import { showSchedule, schCallback } from '../lib/fsm/hours.js';
import { apCallback, showDay, showWeek } from '../lib/fsm/appointments.js';
import { showClients, cliCallback } from '../lib/fsm/clients.js';
import { bkCallback, mreqCallback } from '../lib/fsm/booking.js';
import { localDate } from '../lib/time.js';

// ack — подтверждение нажатия. Само по себе необязательно: если Telegram уже
// счёл запрос устаревшим (400), это не должно срывать основную обработку.
async function ack(cq, text) {
  try {
    await api.answerCallbackQuery({
      callback_query_id: cq.id,
      ...(text ? { text } : {}),
    });
  } catch (e) {
    console.warn('answerCallbackQuery failed (non-fatal)', e?.description || e);
  }
}

// Разбор callback_data: area — до первого ':', action — до второго, arg — всё остальное.
function parseCb(data) {
  const i1 = data.indexOf(':');
  const i2 = data.indexOf(':', i1 + 1);
  if (i1 < 0) return { area: data, action: '', arg: '' };
  const area = data.slice(0, i1);
  if (i2 < 0) return { area, action: data.slice(i1 + 1), arg: '' };
  return { area, action: data.slice(i1 + 1, i2), arg: data.slice(i2 + 1) };
}

export default async function (cq, ctx) {
  const data = cq.data || '';
  const { area, action, arg } = parseCb(data);
  const chatId = cq.message?.chat?.id;
  const from = cq.from;
  const nowSec = Math.floor(Date.now() / 1000);

  try {
    if (area === 'menu') return await onMenu(chatId, from, action, arg, cq, nowSec);
    // Клиентские кнопки не требуют прав мастера.
    if (area === 'bk') { await ack(cq); return await bkCallback(cq, action, arg, from, nowSec); }
    if (area === 'tz') return await onTz(chatId, from, action, arg, cq);
    if (area === 'onb') return await onOnb(chatId, from, action, arg, cq);
    if (area === 'fsm') return await onFsmCancel(chatId, from, cq);

    // Всё ниже требует мастера.
    const master = await getMasterByTg(from.id);
    if (!master) {
      await ack(cq);
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLIENT_NO_PAYLOAD }));
    }

    if (area === 'svc') { await ack(cq); return await svcCallback(cq, action, arg, master); }
    if (area === 'sch') { await ack(cq); return await schCallback(cq, action, arg, master); }
    if (area === 'ap') { await ack(cq); return await apCallback(cq, action, arg, master, nowSec); }
    if (area === 'cli') { await ack(cq); return await cliCallback(cq, action, arg, master, nowSec); }
    if (area === 'mreq') { await ack(cq); return await mreqCallback(cq, action, arg, master, nowSec); }

    await ack(cq);
  } catch (e) {
    console.error('callback handler failed', { data, e });
    await ack(cq, 'Ошибка, попробуйте ещё раз');
  }
}

async function onMenu(chatId, from, action, arg, cq, nowSec) {
  await ack(cq);
  const master = await getMasterByTg(from.id);
  if (!master) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLIENT_NO_PAYLOAD }));

  // section приходит в action (menu:go:<section>), но mainMenu() шлёт menu:go:menu.
  const section = action === 'go' ? arg : action;

  if (section === 'link') {
    const link = await bookLink(master.masterCode);
    return void (
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.LINK(master.name, master.masterCode, link) })
    );
  }

  if (section === 'menu') {
    return void (
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MENU_TITLE(master.name), reply_markup: mainMenu() })
    );
  }

  if (section === 'svc') return void (await showServices(chatId, master));
  if (section === 'svclic') return void (await showServices(chatId, master));
  if (section === 'sch') return void (await showSchedule(chatId, master));
  if (section === 'ap') return void (await showDay(chatId, master, localDate(master.timezone, nowSec), nowSec));
  if (section === 'apwk') return void (await showWeek(chatId, master, localDate(master.timezone, nowSec), nowSec));
  if (section === 'cli') return void (await showClients(chatId, master, nowSec));

  // Рассылка, финансы, настройки — следующие фазы.
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.WIP, reply_markup: mainMenu() });
}

// Выбор часового пояса кнопкой в онбординге.
async function onTz(chatId, from, action, arg, cq) {
  const st = await getState(chatId);
  if (!st || st.state !== 'onb:tz') {
    return void (await ack(cq, 'Диалог уже завершён'));
  }
  if (action === 'pick') {
    const tz = TZ_OPTIONS[Number(arg)];
    if (!tz) return void (await ack(cq, 'Нет такой зоны'));
    await ack(cq);
    return void (await finishOnboarding(chatId, from, tz));
  }
  await ack(cq);
}

// «Оставить имя как есть» в онбординге.
async function onOnb(chatId, from, action, arg, cq) {
  const st = await getState(chatId);
  if (!st || st.state !== 'onb:name') {
    return void (await ack(cq, 'Диалог уже завершён'));
  }
  await ack(cq);
  if (action === 'name_def') {
    await onboardingName(chatId, from, '-');
  }
}

// «❌ Отмена» — прервать FSM без побочных эффектов (spec §17, T19).
async function onFsmCancel(chatId, from, cq) {
  await ack(cq, 'Отменено');
  await clearState(chatId);
  const master = await getMasterByTg(from.id);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: 'Диалог прерван.' + (master ? '\n\n' + T.MENU_TITLE(master.name) : ''),
    reply_markup: master ? mainMenu() : undefined,
  });
}