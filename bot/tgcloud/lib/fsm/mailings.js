// lib/fsm/mailings.js — диалог рассылки (spec §15).

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import {
  mailingAudienceMenu, mailingPreviewMenu, fsmRow, mainMenu, CB,
} from '../kb.js';
import { getState, setState, clearState } from '../state.js';
import { plural } from '../fmt.js';
import { listGroups } from '../svc/crm.js';
import { audienceFor } from '../svc/mailings.js';
import { createMailing, sendChunk, mailingReport } from '../svc/mailings.js';
import { clientsWithMeta } from '../svc/crm.js';

// ---------- Меню рассылок ----------

export async function showMailings(chatId, master) {
  const groups = await listGroups(master.id);
  const nowSec = Math.floor(Date.now() / 1000);
  const all = await clientsWithMeta(master, nowSec);
  const categories = [...new Set(all.map((c) => c.category))];

  const kb = mailingAudienceMenu(groups, categories);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.MAIL_ASK_AUDIENCE,
    reply_markup: kb,
  });
}

// ---------- Выбор аудитории → текст ----------

export async function mailingCallback(cq, action, arg, master, nowSec) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;

  if (action === 'au' || action === 'ag' || action === 'ac') {
    const targetKind = action === 'au' ? 'all' : action === 'ag' ? 'group' : 'category';
    const targetRef = action === 'au' ? null : arg;

    const audience = await audienceFor(master, targetKind, targetRef);
    if (!audience.length) {
      return void (await api.sendMessage({
        chat_id: chatId, parse_mode: 'HTML',
        text: '📣 В этой аудитории нет клиентов с доступным Telegram.',
        reply_markup: fsmRow('mail'),
      }));
    }

    await setState(chatId, userId, 'mail:text', {
      targetKind, targetRef, audienceCount: audience.length,
    });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.MAIL_ASK_TEXT(audienceLabel(targetKind, targetRef, audience.length)),
      reply_markup: fsmRow('mail'),
    }));
  }
}

export async function mailingTextInput(chatId, userId, state, text, master, nowSec) {
  if (state.state === 'mail:text') {
    const d = state.data;
    await setState(chatId, userId, 'mail:preview', {
      ...d, text: text.slice(0, 2000),
    });
    const audience = await audienceFor(master, d.targetKind, d.targetRef);
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.MAIL_PREVIEW(text, audienceLabel(d.targetKind, d.targetRef, audience.length), audience.length),
      reply_markup: mailingPreviewMenu(),
    }));
  }
  return false;
}

// ---------- Предпросмотр → запуск ----------

export async function mailingStartCallback(cq, master, nowSec) {
  const chatId = cq.message.chat.id;
  const st = await getState(chatId);
  if (!st || st.state !== 'mail:preview') {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  }

  const d = st.data;
  const mailing = await createMailing(master, {
    text: d.text,
    targetKind: d.targetKind,
    targetRef: d.targetRef,
  });

  await clearState(chatId);
  await api.sendMessage({
    chat_id: chatId, parse_mode: 'HTML',
    text: T.MAIL_STARTED,
  });

  // Первый чанк отправляем сразу, не дожидаясь /tick.
  const res = await sendChunk(mailing, master, send);

  // Отчёт, если всё уместилось в один чанк.
  if (res.done) {
    const audience = await audienceFor(master, d.targetKind, d.targetRef);
      const report = await mailingReport(master.id, mailing.id);
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.MAIL_DONE(report.sent, report.failed, report.noTgCount),
      reply_markup: mainMenu(),
    });
  }
}

async function send(chatId, text) {
  try {
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text });
    return true;
  } catch (e) {
    return false;
  }
}

function audienceLabel(kind, ref, count) {
  const n = plural(count, 'человеку', 'людям', 'людям');
  if (kind === 'all') return `всем активным (${count} ${n})`;
  if (kind === 'group') return `группе ${ref} (${count} ${n})`;
  if (kind === 'category') return `категории «${ref}» (${count} ${n})`;
  return `${count} ${n}`;
}