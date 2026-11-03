// lib/fsm/services.js — диалоги каталога услуг (spec §5).

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import { fsmRow, servicesMenu, durationMenu, confirmMenu, svc as SVC } from '../kb.js';
import { getState, setState, clearState } from '../state.js';
import { parseMoney, money, esc } from '../fmt.js';
import {
  listServices, getService, createService, updateService, deleteService, moveService,
} from '../svc/services.js';
import { serviceCard } from '../svc/render.js';

// Экран «Услуги».
export async function showServices(chatId, master) {
  const rows = await listServices(master.id, { includeInactive: true });
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.SVC_LIST(rows.map((s) => `${s.active ? '🟢' : '⚪️'} ${esc(s.name)} · ${s.durationMin} мин · ${s.priceFrom ? 'от ' : ''}${money(s.priceCents)}`)),
    reply_markup: servicesMenu(rows),
  });
}

// Данные нового клиента/услуги собираем в bot_states.data.
export const svcDraftKey = 'svc_draft';

export async function startAddService(chatId, userId) {
  await setState(chatId, userId, 'svc:name', { draft: {} });
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_NAME, reply_markup: fsmRow('svc') });
}

// --- ввод текстом ---

export async function svcTextInput(chatId, userId, state, text, master) {
  const draft = state.data?.draft || {};

  if (state.state === 'svc:name') {
    draft.name = text.slice(0, 80);
    await setState(chatId, userId, 'svc:duration', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_DURATION, reply_markup: durationMenu(),
    }));
  }

  if (state.state === 'svc:duration') {
    const min = Number(text);
    if (!Number.isInteger(min) || min < 5 || min > 600) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_DURATION_BAD }));
    }
    draft.durationMin = min;
    await setState(chatId, userId, 'svc:price', { draft });
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE, reply_markup: fsmRow('svc') }));
  }

  if (state.state === 'svc:price') {
    const cents = parseMoney(text);
    if (cents == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE_BAD }));
    }
    draft.priceCents = cents;
    await setState(chatId, userId, 'svc:from', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.SVC_ASK_FROM(draft.name, money(cents), draft.durationMin),
      reply_markup: { inline_keyboard: [[
        { text: 'Да, цена «от»', callback_data: SVC.fromYes() },
        { text: 'Нет, точная', callback_data: SVC.fromNo() },
      ]] },
    }));
  }

  if (state.state === 'svc:desc') {
    draft.description = text === '-' ? null : text.slice(0, 300);
    await setState(chatId, userId, 'svc:popular', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_POPULAR,
      reply_markup: { inline_keyboard: [[
        { text: '⭐ Да', callback_data: SVC.popYes() },
        { text: 'Нет', callback_data: SVC.popNo() },
      ]] },
    }));
  }

  if (state.state === 'svc:edit') {
    return await applySvcEdit(chatId, userId, draft, text, master);
  }
  return false;
}

async function applySvcEdit(chatId, userId, draft, text, master) {
  const field = draft.field;
  const id = draft.serviceId;
  const patch = {};
  if (field === 'name') patch.name = text.slice(0, 80);
  else if (field === 'durationMin') {
    const min = Number(text);
    if (!Number.isInteger(min) || min < 5 || min > 600) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_DURATION_BAD }));
    }
    patch.durationMin = min;
  } else if (field === 'priceCents') {
    const cents = parseMoney(text);
    if (cents == null) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE_BAD }));
    }
    patch.priceCents = cents;
  } else if (field === 'description') {
    patch.description = text === '-' ? null : text.slice(0, 300);
  }

  const updated = await updateService(master.id, id, patch);
  await clearState(chatId);
  if (!updated) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const card = serviceCard(updated);
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_SAVED(updated.name) });
  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup });
}

// --- кнопки ---

export async function svcCallback(cq, action, arg, master) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const id = Number(arg);

  if (action === 'add') {
    return void (await startAddService(chatId, userId));
  }

  if (action === 'dm') {
    const st = await getState(chatId);
    if (!st || st.state !== 'svc:duration') return;
    const draft = { ...(st.data?.draft || {}), durationMin: Number(arg) };
    await setState(chatId, userId, 'svc:price', { draft });
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_PRICE, reply_markup: fsmRow('svc') }));
  }

  if (action === 'fy' || action === 'fn') {
    const st = await getState(chatId);
    if (!st || st.state !== 'svc:from') return;
    const draft = { ...st.data.draft, priceFrom: action === 'fy' };
    await setState(chatId, userId, 'svc:desc', { draft });
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_ASK_DESC, reply_markup: fsmRow('svc') }));
  }

  if (action === 'py' || action === 'pn') {
    const st = await getState(chatId);
    if (!st || st.state !== 'svc:popular') return;
    const draft = { ...st.data.draft, isPopular: action === 'py' };
    const created = await createService(master.id, draft);
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_SAVED(created.name) });
    const card = serviceCard(created);
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup }));
  }

  if (!Number.isInteger(id) || id <= 0) return;

  if (action === 'open') {
    const s = await getService(master.id, id);
    if (!s) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    const card = serviceCard(s);
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup }));
  }

  if (action === 'nm' || action === 'du' || action === 'pr' || action === 'ds') {
    const field = { nm: 'name', du: 'durationMin', pr: 'priceCents', ds: 'description' }[action];
    await setState(chatId, userId, 'svc:edit', { draft: { serviceId: id, field } });
    const prompt = {
      name: T.SVC_EDIT_NAME,
      durationMin: T.SVC_EDIT_DURATION,
      priceCents: T.SVC_EDIT_PRICE,
      description: T.SVC_EDIT_DESC,
    }[field];
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: prompt, reply_markup: fsmRow('svc') }));
  }

  if (action === 'fr' || action === 'ac' || action === 'pp') {
    const s = await getService(master.id, id);
    if (!s) return;
    const patch = action === 'fr' ? { priceFrom: !s.priceFrom }
      : action === 'ac' ? { active: !s.active }
        : { isPopular: !s.isPopular };
    const updated = await updateService(master.id, id, patch);
    const card = serviceCard(updated);
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: card.text, reply_markup: card.markup }));
  }

  if (action === 'dl') {
    const s = await getService(master.id, id);
    if (!s) return;
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: `Удалить услугу «${esc(s.name)}»?`,
      reply_markup: confirmMenu('svc', id),
    }));
  }

  if (action === 'dy') {
    const nowSec = Math.floor(Date.now() / 1000);
    const res = await deleteService(master.id, id, nowSec);
    if (!res.ok) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_DELETE_BLOCKED }));
    }
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.SVC_DELETED });
    return void (await showServices(chatId, master));
  }

  if (action === 'up' || action === 'dn') {
    await moveService(master.id, id, action === 'up' ? 'up' : 'down');
    return void (await showServices(chatId, master));
  }
}