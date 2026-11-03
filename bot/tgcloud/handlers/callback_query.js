// handlers/callback_query.js — единый роутер инлайн-кнопок (spec §1).

import { api } from 'sdk';
import { T } from '../lib/i18n/ru.js';
import { mainMenu, TZ_OPTIONS } from '../lib/kb.js';
import { getMasterByTg } from '../lib/access.js';
import { getState, setState, clearState } from '../lib/state.js';
import { bookLink } from '../lib/botinfo.js';
import { finishOnboarding, onboardingName } from '../lib/svc/onboarding.js';

export default async function (cq, ctx) {
  const data = cq.data || '';
  const [area, action, arg] = data.split(':');
  const chatId = cq.message?.chat?.id;
  const from = cq.from;

  try {
    if (area === 'menu') return await onMenu(chatId, from, arg, cq);
    if (area === 'tz') return await onTz(chatId, from, action, arg, cq);
    if (area === 'onb') return await onOnb(chatId, from, action, arg, cq);
    if (area === 'fsm') return await onFsmCancel(chatId, from, cq);

    await api.answerCallbackQuery({ callback_query_id: cq.id });
  } catch (e) {
    console.error('callback handler failed', { data, e });
    try {
      await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Ошибка, попробуйте ещё раз' });
    } catch { /* ignore */ }
  }
}

async function onMenu(chatId, from, section, cq) {
  await api.answerCallbackQuery({ callback_query_id: cq.id });
  const master = await getMasterByTg(from.id);
  if (!master) return void (await api.sendMessage({ chat_id: chatId, text: T.CLIENT_NO_PAYLOAD }));

  if (section === 'link') {
    const link = await bookLink(master.masterCode);
    return void (
      await api.sendMessage({ chat_id: chatId, text: T.LINK(master.name, master.masterCode, link) })
    );
  }

  await api.sendMessage({ chat_id: chatId, text: T.WIP, reply_markup: mainMenu() });
  // Фазы 1–5: записи (ap), расписание (sch), клиенты (cli), рассылка (mail),
  // финансы (fin), настройки (set).
}

// Выбор часового пояса кнопкой в онбординге.
async function onTz(chatId, from, action, arg, cq) {
  const st = await getState(chatId);
  if (!st || st.state !== 'onb:tz') {
    return void (await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Диалог уже завершён' }));
  }
  if (action === 'pick') {
    const tz = TZ_OPTIONS[Number(arg)];
    if (!tz) return void (await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Нет такой зоны' }));
    await api.answerCallbackQuery({ callback_query_id: cq.id });
    return void (await finishOnboarding(chatId, from, tz));
  }
  await api.answerCallbackQuery({ callback_query_id: cq.id });
}

// «Оставить имя как есть» в онбординге.
async function onOnb(chatId, from, action, arg, cq) {
  const st = await getState(chatId);
  if (!st || st.state !== 'onb:name') {
    return void (await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Диалог уже завершён' }));
  }
  await api.answerCallbackQuery({ callback_query_id: cq.id });
  if (action === 'name_def') {
    await onboardingName(chatId, from, '-');
  }
}

// «❌ Отмена» — прервать FSM без побочных эффектов (spec §17, T19).
async function onFsmCancel(chatId, from, cq) {
  await api.answerCallbackQuery({ callback_query_id: cq.id, text: 'Отменено' });
  await clearState(chatId);
  const master = await getMasterByTg(from.id);
  await api.sendMessage({
    chat_id: chatId,
    text: 'Диалог прерван.' + (master ? '\n\n' + T.MENU_TITLE(master.name) : ''),
    reply_markup: master ? mainMenu() : undefined,
  });
}
