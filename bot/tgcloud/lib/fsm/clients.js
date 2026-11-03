// lib/fsm/clients.js — CRM-диалоги: список, фильтры, поиск, карточка,
// редактирование, группы, чёрный список, архив, удаление (spec §9).

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import {
  fsmRow, clientsScreenMenu, clientCardMenu, clientGroupsMenu,
  groupsMenu, groupMembersMenu, cli as C, CB,
} from '../kb.js';
import { setState, clearState } from '../state.js';
import { esc, money } from '../fmt.js';
import {
  clientsWithMeta, filterClients, pageOf, clientCardData,
  listGroups, createGroup, deleteGroup, groupMembers, groupsOfClient,
  toggleGroupMember, updateClient, deleteClient,
} from '../svc/crm.js';
import { createClient, listClients } from '../svc/clients.js';
import { startAdd as startAddAppointment } from './appointments.js';

// ---------- Список ----------

export async function showClients(chatId, master, nowSec, filter = 'all', page = 0, query = '') {
  const all = await clientsWithMeta(master, nowSec);
  const filtered = filterClients(all, filter, query);
  const pg = pageOf(filtered, page);

  if (!all.length) {
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.CLI_EMPTY,
      reply_markup: { inline_keyboard: [
        [{ text: '➕ Добавить клиента', callback_data: C.add() }],
        [{ text: '📁 Группы', callback_data: C.groupsList() }],
        [{ text: '🏠 Меню', callback_data: CB.menu('menu') }],
      ] },
    }));
  }

  const labels = {
    all: 'Все', new: 'Новые', regular: 'Постоянные',
    lost: 'Потеряшки', blacklist: 'Чёрный список', archived: 'Архив',
  };
  const lines = pg.items.map((c) => {
    const bits = [`<b>${esc(c.displayName)}</b>`];
    if (c.phone) bits.push(esc(c.phone));
    if (c.stats?.visits) bits.push(`${c.stats.visits} виз.`);
    return `${icon(c.category)} ${bits.join(' · ')}`;
  });

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: pg.items.length
      ? T.CLI_LIST(labels[filter] || filter, pg.total, pg.page, pg.pages, lines) + (query ? `\n\n🔍 «${esc(query)}»` : '')
      : T.CLI_SEARCH_EMPTY,
    reply_markup: clientsScreenMenu(
      filter, pg.page, pg.pages,
      pg.items.map((c) => ({ id: c.id, name: c.displayName, visits: c.stats?.visits || 0, category: c.category })),
    ),
  });
}

function icon(category) {
  return { new: '🆕', regular: '⭐', lost: '😴', blacklist: '⛔', archived: '📦' }[category] || '•';
}

// ---------- Карточка ----------

export async function showClient(chatId, master, clientId, nowSec) {
  const d = await clientCardData(master, clientId, nowSec);
  if (!d) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const text = T.CLI_CARD(d, money) + (d.client.tgUserId ? '' : T.CLI_CARD_NO_TG);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text,
    reply_markup: clientCardMenu(d.client, d.groups),
  });
}

// ---------- Группы ----------

export async function showGroups(chatId, master) {
  const groups = await listGroups(master.id);
  const counts = {};
  for (const g of groups) counts[g.id] = (await groupMembers(g.id)).length;
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: groups.length
      ? T.GRP_TITLE(groups.map((g) => `📁 ${esc(g.name)} — ${counts[g.id]} чел.`))
      : T.GRP_EMPTY,
    reply_markup: groupsMenu(groups, counts),
  });
}

export async function showGroup(chatId, master, groupId) {
  const groups = await listGroups(master.id);
  const g = groups.find((x) => x.id === groupId);
  if (!g) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const members = await groupMembers(groupId);
  const memberIds = members.map((m) => m.clientId);
  const all = await listClients(master.id, { includeArchived: true });
  // В списке показываем всех, помечая входящих.
  const lines = all
    .filter((c) => memberIds.includes(c.id))
    .map((c) => `✅ ${esc(c.displayName)}`);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.GRP_MEMBERS(g.name, lines),
    reply_markup: groupMembersMenu(groupId, all, memberIds),
  });
}

export async function showClientGroups(chatId, master, clientId) {
  const groups = await listGroups(master.id);
  const mine = await groupsOfClient(master.id, clientId);
  const memberIds = mine.map((g) => g.id);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: groups.length
      ? '📁 Группы клиента — нажмите, чтобы добавить/убрать:'
      : T.GRP_EMPTY,
    reply_markup: clientGroupsMenu(clientId, groups, memberIds),
  });
}

// ---------- Ввод текстом ----------

export async function cliTextInput(chatId, userId, state, text, master, nowSec) {
  const d = state.data || {};

  if (state.state === 'cli:search') {
    await clearState(chatId);
    const q = text === '-' ? '' : text.trim();
    return void (await showClients(chatId, master, nowSec, d.filter || 'all', 0, q));
  }

  if (state.state === 'cli:add_name') {
    await setState(chatId, userId, 'cli:add_phone', { draft: { name: text.slice(0, 80) } });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.CLI_ASK_PHONE, reply_markup: fsmRow('cli'),
    }));
  }

  if (state.state === 'cli:add_phone') {
    const draft = { ...d.draft, phone: text === '-' ? null : text.slice(0, 32) };
    await setState(chatId, userId, 'cli:add_bday', { draft });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.CLI_ASK_BIRTHDAY, reply_markup: fsmRow('cli'),
    }));
  }

  if (state.state === 'cli:add_bday') {
    let birthday = null;
    if (text !== '-') {
      const iso = parseBirthday(text);
      if (!iso) {
        return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_EDIT_BIRTHDAY_BAD }));
      }
      birthday = iso;
    }
    const c = await createClient(master.id, { displayName: d.draft.name, phone: d.draft.phone, birthday });
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_CREATED(c.displayName) });
    return void (await showClient(chatId, master, c.id, nowSec));
  }

  // Редактирование полей карточки.
  if (state.state === 'cli:edit') {
    const { clientId, field } = d;
    const patch = {};
    if (field === 'displayName') patch.displayName = text.slice(0, 80);
    else if (field === 'phone') patch.phone = text === '-' ? null : text.slice(0, 32);
    else if (field === 'notes') patch.notes = text === '-' ? null : text.slice(0, 500);
    else if (field === 'birthday') {
      if (text === '-') patch.birthday = null;
      else {
        const iso = parseBirthday(text);
        if (!iso) {
          return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_EDIT_BIRTHDAY_BAD }));
        }
        patch.birthday = iso;
      }
    }
    const updated = await updateClient(master.id, clientId, patch);
    await clearState(chatId);
    if (!updated) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_SAVED });
    return void (await showClient(chatId, master, clientId, nowSec));
  }

  if (state.state === 'cli:group_name') {
    const g = await createGroup(master.id, text);
    await clearState(chatId);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.GRP_CREATED(g.name) });
    return void (await showGroups(chatId, master));
  }
  return false;
}

// '14.03' | '14-03' | '14.03.1990' → 'MM-DD'
function parseBirthday(text) {
  const m = /^(\d{1,2})[.\-/](\d{1,2})(?:[.\-/]\d{2,4})?$/.exec(String(text).trim());
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// ---------- Кнопки ----------

export async function cliCallback(cq, action, arg, master, nowSec) {
  const chatId = cq.message.chat.id;
  const userId = cq.from.id;
  const parts = String(arg ?? '').split(':');

  if (action === 'pg') {
    return void (await showClients(chatId, master, nowSec, parts[0], Number(parts[1]) || 0));
  }
  if (action === 'fl') {
    const filter = parts[0] || 'all';
    if (filter === 'menu') return void (await showClients(chatId, master, nowSec, 'all', 0));
    return void (await showClients(chatId, master, nowSec, filter, 0));
  }
  if (action === 'sr') {
    await setState(chatId, userId, 'cli:search', { filter: 'all' });
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.CLI_SEARCH_PROMPT, reply_markup: fsmRow('cli'),
    }));
  }
  if (action === 'add') {
    await setState(chatId, userId, 'cli:add_name', {});
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.CLI_ASK_NAME, reply_markup: fsmRow('cli'),
    }));
  }

  const id = Number(parts[0]);
  if (action === 'op') return void (await showClient(chatId, master, id, nowSec));

  if (action === 'nm' || action === 'ph' || action === 'bd' || action === 'nt') {
    const field = { nm: 'displayName', ph: 'phone', bd: 'birthday', nt: 'notes' }[action];
    await setState(chatId, userId, 'cli:edit', { clientId: id, field });
    const prompt = {
      displayName: T.CLI_EDIT_NAME,
      phone: T.CLI_EDIT_PHONE,
      birthday: T.CLI_EDIT_BIRTHDAY,
      notes: T.CLI_EDIT_NOTES,
    }[field];
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: prompt, reply_markup: fsmRow('cli'),
    }));
  }

  if (action === 'bk') {
    // Записать клиента: запускаем мастер записи сразу с выбранным клиентом.
    return void (await startAddAppointment(chatId, userId, master, id));
  }

  if (action === 'bl') {
    const c = await dbClient(master, id);
    if (!c) return;
    await updateClient(master.id, id, { blacklisted: !c.blacklisted });
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: c.blacklisted ? T.CLI_BL_OFF : T.CLI_BL_ON,
    });
    return void (await showClient(chatId, master, id, nowSec));
  }

  if (action === 'ar') {
    const c = await dbClient(master, id);
    if (!c) return;
    await updateClient(master.id, id, { archived: !c.archived });
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: c.archived ? T.CLI_ARCH_OFF : T.CLI_ARCH_ON,
    });
    return void (await showClient(chatId, master, id, nowSec));
  }

  if (action === 'dl') {
    const c = await dbClient(master, id);
    if (!c) return;
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.CLI_DEL_CONFIRM(c.displayName),
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Удалить', callback_data: C.delConfirm(id) },
          { text: '❌ Нет', callback_data: C.open(id) },
        ]],
      },
    }));
  }
  if (action === 'dy') {
    const res = await deleteClient(master.id, id);
    if (!res.ok) {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_DEL_BLOCKED }));
    }
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.CLI_DELETED });
    return void (await showClients(chatId, master, nowSec, 'all', 0));
  }

  if (action === 'gs') return void (await showClientGroups(chatId, master, id));
  if (action === 'gt') {
    const gid = Number(parts[1]);
    await toggleGroupMember(gid, id);
    return void (await showClientGroups(chatId, master, id));
  }

  if (action === 'gl') return void (await showGroups(chatId, master));
  if (action === 'ga') {
    await setState(chatId, userId, 'cli:group_name', {});
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text: T.GRP_ASK_NAME, reply_markup: fsmRow('cli'),
    }));
  }
  if (action === 'go') return void (await showGroup(chatId, master, id));
  if (action === 'gm') {
    const gid = Number(parts[0]);
    const cid = Number(parts[1]);
    await toggleGroupMember(gid, cid);
    return void (await showGroup(chatId, master, gid));
  }
  if (action === 'gd') {
    const groups = await listGroups(master.id);
    const g = groups.find((x) => x.id === id);
    if (!g) return;
    return void (await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML',
      text: T.GRP_DEL_CONFIRM(g.name),
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Удалить', callback_data: C.groupDelConfirm(id) },
          { text: '❌ Нет', callback_data: C.groupOpen(id) },
        ]],
      },
    }));
  }
  if (action === 'gy') {
    await deleteGroup(master.id, id);
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.GRP_DELETED });
    return void (await showGroups(chatId, master));
  }
}

// Локальный геттер, чтобы не тянуть импорт в кнопочную часть.
async function dbClient(master, id) {
  const list = await listClients(master.id, { includeArchived: true });
  return list.find((c) => c.id === id) || null;
}