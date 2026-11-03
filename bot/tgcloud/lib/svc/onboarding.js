// lib/svc/onboarding.js — регистрация мастера (spec §4).

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import { mainMenu, tzMenu } from '../kb.js';
import { createMaster } from '../access.js';
import { getState, setState, clearState } from '../state.js';
import { bookLink } from '../botinfo.js';

export function validTz(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function startOnboarding(chatId, from) {
  const defName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Мастер';
  await setState(chatId, from.id, 'onb:name', { defName });
  await api.sendMessage({
    chat_id: chatId,
    text: T.ONB_ASK_NAME(defName),
    reply_markup: {
      inline_keyboard: [[{ text: '➡️ Оставить как есть', callback_data: 'onb:name_def:-' }]],
    },
  });
}

// Шаг 1: имя принято → шаг 2 (часовой пояс).
export async function onboardingName(chatId, from, text) {
  const st = await getState(chatId);
  const name = (text === '-' ? st?.data?.defName : text)?.trim().slice(0, 64);
  await setState(chatId, from.id, 'onb:tz', { name: name || 'Мастер' });
  await api.sendMessage({ chat_id: chatId, text: T.ONB_ASK_TZ, reply_markup: tzMenu() });
}

// Финал: создание мастера + приветствие со ссылкой записи.
export async function finishOnboarding(chatId, from, timezone) {
  const st = await getState(chatId);
  const name = st?.data?.name || st?.data?.defName || 'Мастер';
  const master = await createMaster({ tgUserId: from.id, tgChatId: chatId, name, timezone });
  await clearState(chatId);
  const link = await bookLink(master.masterCode);
  await api.sendMessage({ chat_id: chatId, text: T.ONB_DONE(master.name, timezone, link) });
  await api.sendMessage({ chat_id: chatId, text: T.MENU_TITLE(master.name), reply_markup: mainMenu() });
}
