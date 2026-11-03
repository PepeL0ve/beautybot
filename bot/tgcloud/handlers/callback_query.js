// handlers/callback_query.js — единый роутер инлайн-кнопок (spec §1).

import { api } from 'sdk';
import { T } from '../lib/i18n/ru.js';
import { mainMenu, TZ_OPTIONS } from '../lib/kb.js';
import { getMasterByTg } from '../lib/access.js';
import { getState, setState, clearState } from '../lib/state.js';
import { bookLink } from '../lib/botinfo.js';
import { finishOnboarding, onboardingName } from '../lib/svc/onboarding.js';

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

    await ack(cq);
  } catch (e) {
    console.error('callback handler failed', { data, e });
    await ack(cq, 'Ошибка, попробуйте ещё раз');
  }
}

async function onMenu(chatId, from, section, cq) {
  await ack(cq);
  const master = await getMasterByTg(from.id);
  if (!master) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLIENT_NO_PAYLOAD }));

  if (section === 'link') {
    const link = await bookLink(master.masterCode);
    return void (
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.LINK(master.name, master.masterCode, link) })
    );
  }

  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.WIP, reply_markup: mainMenu() });
  // Фазы 1–5: записи (ap), расписание (sch), клиенты (cli), рассылка (mail),
  // финансы (fin), настройки (set).
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
