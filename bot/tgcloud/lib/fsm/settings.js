// lib/fsm/settings.js — настройки мастера (spec §14).

import { api, db } from 'sdk';
import { eq } from 'sdk/db';
import { T } from '../i18n/ru.js';
import { settingsMenu, pageSettingsMenu, fsmRow } from '../kb.js';
import { setState, clearState } from '../state.js';
import { esc } from '../fmt.js';
import { masters } from '../../schema.js';
import { withDefaults } from '../svc/settings.js';
import { bookLink } from '../botinfo.js';
import { generateMasterCode } from '../access.js';

const TOGGLES = ['auto_confirm', 'only_existing', 'birthday_greet', 'auto_income'];

export async function showSettings(chatId, master) {
  const s = withDefaults(master.settings);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.SET_TITLE(s),
    reply_markup: settingsMenu(s),
  });
}

export async function settingsCallback(cq, action, arg, master, nowSec) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;

  if (action === 'tg') {
    const key = arg;
    if (!TOGGLES.includes(key)) return;
    const newSettings = { ...withDefaults(master.settings), [key]: !master.settings[key] };
    await db.update(masters).set({ settings: newSettings }).where(eq(masters.id, master.id)).run();
    return void (await showSettings(chatId, { ...master, settings: newSettings }));
  }

  if (action === 'pg') {
    return void (await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: T.SET_PAGE_TITLE,
      reply_markup: pageSettingsMenu(),
    }));
  }

  if (action === 'bl') {
    await setState(chatId, userId, 'set:blurb', {});
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.SET_ASK_BLURB, reply_markup: fsmRow('set'),
    }));
  }

  if (action === 'nm') {
    await setState(chatId, userId, 'set:name', {});
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.SET_ASK_NAME, reply_markup: fsmRow('set'),
    }));
  }

  if (action === 'rg') {
    const newCode = generateMasterCode();
    await db.update(masters).set({ masterCode: newCode }).where(eq(masters.id, master.id)).run();
    const link = await bookLink(newCode);
    return void (await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: T.SET_REGENERATED(newCode, link),
    }));
  }
}

export async function settingsTextInput(chatId, userId, state, text, master) {
  if (state.state === 'set:blurb') {
    const blurb = text === '-' ? null : text.slice(0, 300);
    await db.update(masters).set({ publicBlurb: blurb }).where(eq(masters.id, master.id)).run();
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SET_SAVED });
    return void (await showSettings(chatId, { ...master, publicBlurb: blurb }));
  }
  if (state.state === 'set:name') {
    const name = text.slice(0, 64);
    await db.update(masters).set({ name }).where(eq(masters.id, master.id)).run();
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SET_SAVED });
    return void (await showSettings(chatId, { ...master, name }));
  }
  return false;
}