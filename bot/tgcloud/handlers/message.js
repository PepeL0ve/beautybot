// handlers/message.js — команды, FSM-ввод текстом, перехват /tick (spec §3–4, §13).

import { api, db } from 'sdk';
import { T } from '../lib/i18n/ru.js';
import { mainMenu } from '../lib/kb.js';
import { isAllowed, getMasterByTg, getMasterByCode } from '../lib/access.js';
import { getState, clearState } from '../lib/state.js';
import {
  startOnboarding, onboardingName, validTz, finishOnboarding,
} from '../lib/svc/onboarding.js';
import { runSweep } from '../lib/svc/sweep.js';
import { ticks } from '../schema.js';

export default async function (message, ctx) {
  const chatId = message.chat.id;
  const from = message.from || {};
  const text = (message.text || '').trim();

  try {
    if (text === '/tick') return await handleTick(from, chatId);
    if (text.startsWith('/start')) return await handleStart(message, chatId, from);
    if (text === '/menu') return await sendMenu(chatId, from);

    // FSM-диалоги (состояние персистентно в БД, spec §17)
    const st = await getState(chatId);
    if (st) {
      if (text === '/cancel') {
        await clearState(chatId);
        return void (await api.sendMessage({ chat_id: chatId, text: 'Диалог прерван.' }));
      }
      if (st.state === 'onb:name') return void (await onboardingName(chatId, from, text));
      if (st.state === 'onb:tz') return void (await onboardingTzText(chatId, from, text));
    }

    // Ничего не распознано — контекстная подсказка
    const master = await getMasterByTg(from.id);
    if (master) {
      await api.sendMessage({ chat_id: chatId, text: T.MENU_TITLE(master.name), reply_markup: mainMenu() });
    } else {
      await api.sendMessage({ chat_id: chatId, text: T.CLIENT_NO_PAYLOAD });
    }
  } catch (e) {
    console.error('message handler failed', e);
    try {
      await api.sendMessage({ chat_id: chatId, text: T.ERR });
    } catch { /* чат мог быть недоступен */ }
  }
}

async function sendMenu(chatId, from) {
  const master = await getMasterByTg(from.id);
  if (!master) return void (await api.sendMessage({ chat_id: chatId, text: T.CLIENT_NO_PAYLOAD }));
  await api.sendMessage({ chat_id: chatId, text: T.MENU_TITLE(master.name), reply_markup: mainMenu() });
}

// /start — маршрутизация по payload (deep link) и доступу (spec §3).
async function handleStart(message, chatId, from) {
  const payload = message.text.split(/\s+/).slice(1).join(' ');

  if (payload.startsWith('book_')) {
    const master = await getMasterByCode(payload.slice(5).toUpperCase());
    if (!master) return void (await api.sendMessage({ chat_id: chatId, text: T.MASTER_NOT_FOUND }));
    // Фаза 0: визитка без кнопок записи. Фаза 3 добавит флоу.
    return void (await api.sendMessage({ chat_id: chatId, text: T.CLIENT_CARD(master) }));
  }

  const master = await getMasterByTg(from.id);
  if (master) return void (await sendMenu(chatId, from));

  if (!(await isAllowed(from.id))) {
    return void (await api.sendMessage({ chat_id: chatId, text: T.DENIED(from.id) }));
  }
  await startOnboarding(chatId, from);
}

// Шаг онбординга 2: часовой пояс текстом (IANA).
async function onboardingTzText(chatId, from, text) {
  if (!validTz(text)) {
    return void (await api.sendMessage({ chat_id: chatId, text: T.ONB_BAD_TZ }));
  }
  await finishOnboarding(chatId, from, text.trim());
}

// /tick — скрытая команда свипа (spec §13). Без видимого ответа.
async function handleTick(from, chatId) {
  if (!(await isAllowed(from.id))) return; // чужим молча игнорируем
  await db.insert(ticks).values({ note: 'manual' }).run();
  try {
    await runSweep(Math.floor(Date.now() / 1000));
  } catch (e) {
    console.error('sweep failed', e);
  }
}
