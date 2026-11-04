// lib/fsm/booking.js — клиентская сторона: визитка, запись, мои записи,
// отмена, отзывы (spec §10–§12). Роль определяется master_code, а не доступом.

import { api } from 'sdk';
import { T } from '../i18n/ru.js';
import {
  clientBookingCardMenu, clientServicesMenu, clientDatesMenu, clientSlotsMenu,
  clientConfirmMenu, myAppointmentsMenu, cancelConfirmMenu, waitlistOfferMenu,
  reviewListMenu, starsMenu, masterRequestMenu,
} from '../kb.js';
import { setState, clearState } from '../state.js';
import { esc, money } from '../fmt.js';
import { fmtDate, minToHHMM, localMin } from '../time.js';
import { getMasterByCode } from '../access.js';
import {
  servicesForCard, availableDates, book, clientOfMaster, bookingBlockReason,
  myAppointments, reviewable, cancelByClient, submitReview, addToWaitlist,
  masterChatId, clientChatId, waitlistForDate, markWaitlistNotified,
} from '../svc/booking.js';
import { slotsForDate } from '../svc/schedule.js';
import { getService } from '../svc/services.js';
import { enrich, apDate, getAppointment, setStatus } from '../svc/appointments.js';

// ---------- Визитка ----------

export async function showCard(chatId, master, from) {
  const { all, popular } = await servicesForCard(master);
  const client = await clientOfMaster(master, from);
  const block = bookingBlockReason(master, client);
  // Записываться можно, если есть хотя бы одна активная услуга и нет блокировки.
  const canBook = !block && all.length > 0;
  const showcase = popular.length ? popular : all.slice(0, 5);

  const text = block
    ? (block === 'BLACKLIST' ? T.BK_BLOCKED_BLACKLIST : T.BK_BLOCKED_EXISTING)
    : (all.length ? T.BK_CARD(master, showcase) : T.BK_CARD_NO_SERVICES(master.name));

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text,
    reply_markup: block ? undefined : clientBookingCardMenu(master.masterCode, { canBook }),
  });
}

// ---------- Запись ----------

async function showServices(chatId, master) {
  const { all } = await servicesForCard(master);
  if (!all.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_NO_SERVICES_FOR_BOOK }));
  }
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.BK_ASK_SERVICE,
    reply_markup: clientServicesMenu(master.masterCode, all),
  });
}

async function showDates(chatId, master, svcId, nowSec) {
  const svc = await getService(master.id, svcId);
  if (!svc) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const dates = await availableDates(master, svc.durationMin, nowSec);
  if (!dates.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_NO_DATES }));
  }
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: `${esc(svc.name)} · ${svc.durationMin} мин\n\n${T.BK_ASK_DATE}`,
    reply_markup: clientDatesMenu(master.masterCode, svcId, dates, (d) => fmtDate(d)),
  });
}

async function showSlots(chatId, master, svcId, dateStr, nowSec) {
  const svc = await getService(master.id, svcId);
  if (!svc) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const slots = await slotsForDate(master, dateStr, svc.durationMin, nowSec);
  if (!slots.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_NO_SLOTS }));
  }
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.BK_ASK_TIME(svc, dateStr),
    reply_markup: clientSlotsMenu(master.masterCode, svcId, dateStr, slots, minToHHMM),
  });
}

async function showConfirm(chatId, master, svcId, dateStr, startMin) {
  const svc = await getService(master.id, svcId);
  if (!svc) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.BK_CONFIRM(svc, dateStr, minToHHMM(startMin), money(svc.priceCents)),
    reply_markup: clientConfirmMenu(master.masterCode, svcId, dateStr, startMin),
  });
}

// Заявка создана → уведомить клиента и мастера.
async function finalizeBook(chatId, master, from, svcId, dateStr, startMin, nowSec) {
  const res = await book(master, from, { serviceId: svcId, dateStr, startMin }, nowSec);
  if (!res.ok) {
    if (res.reason === 'SLOT_TAKEN') {
      await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_NO_SLOTS });
      return void (await showSlots(chatId, master, svcId, dateStr, nowSec));
    }
    if (res.reason === 'BLACKLIST') {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_BLOCKED_BLACKLIST }));
    }
    if (res.reason === 'ONLY_EXISTING') {
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.BK_BLOCKED_EXISTING }));
    }
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  }

  const time = minToHHMM(startMin);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: res.autoConfirm
      ? T.BK_SENT_CONFIRMED(res.service, dateStr, time)
      : T.BK_SENT_PENDING(res.service, dateStr, time),
  });

  // Мастеру — заявка с кнопками (только если не авто-подтверждение).
  const mChat = await masterChatId(master.id);
  if (mChat) {
    if (res.autoConfirm) {
      await send(mChat, T.NOTIF_NEW_BOOKED(
        res.client.displayName, res.service.name, dateStr, time,
      ));
    } else {
      await send(mChat, T.NOTIF_NEW_REQUEST(
        res.client.displayName, res.service.name, dateStr, time,
        money(res.appointment.priceCents), !!res.client.tgUserId,
      ), masterRequestMenu(res.appointment.id));
    }
  }
}

async function send(chatId, text, markup) {
  try {
    await api.sendMessage({
      chat_id: chatId, parse_mode: 'HTML', text, ...(markup ? { reply_markup: markup } : {}),
    });
    return true;
  } catch (e) {
    console.warn('notify failed', e?.description || e);
    return false;
  }
}

// ---------- Мои записи ----------

async function showMy(chatId, master, from) {
  const client = await clientOfMaster(master, from);
  if (!client) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MY_EMPTY }));
  }
  const { upcoming, past } = await myAppointments(master, client.id, Math.floor(Date.now() / 1000));
  const upcomingView = upcoming.map((a) => ({ ...a, time: minToHHMM(localMin(master.timezone, a.startsAt)) }));

  const lines = upcomingView.map(
    (a) => T.MY_AP(a, a.serviceName, a.time),
  );
  let text = T.MY_EMPTY;
  if (upcomingView.length) text = T.MY_UPCOMING(lines);
  if (past.length) {
    text += T.MY_PAST_HEAD + '\n' + past.map((a) => {
      const mark = a.status === 'completed' ? '✔️' : a.status === 'canceled' ? '❌' : a.status === 'no_show' ? '🚫' : '⏳';
      return `${mark} ${esc(fmtDate(a.dateStr))} · ${esc(a.serviceName || 'услуга')}`;
    }).join('\n');
  }

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text,
    reply_markup: myAppointmentsMenu(
      master.masterCode,
      upcomingView.map((a) => ({ id: a.id, dateStr: a.dateStr, time: a.time, serviceName: a.serviceName })),
    ),
  });
}

// ---------- Отмена клиентом ----------

async function cancelFlow(chatId, master, from, apId, nowSec, force) {
  const client = await clientOfMaster(master, from);
  if (!client) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MY_EMPTY }));

  // Найдём запись клиента (полное обогащение для текста).
  const all = await dayAppointmentsForAp(master, apId);
  if (!all) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));

  const time = minToHHMM(localMin(master.timezone, all.startsAt));
  const dateStr = apDate(all, master.timezone);

  if (!force) {
    return void (await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: T.MY_CANCEL_CONFIRM(all.service?.name || 'услуга', dateStr, time),
      reply_markup: cancelConfirmMenu(master.masterCode, apId),
    }));
  }

  const res = await cancelByClient(master, apId, client.id);
  if (!res.ok) {
    const text = res.reason === 'NOT_ACTIVE' ? T.MY_CANCEL_TOO_LATE : T.ERR;
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text }));
  }

  await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MY_CANCELED });

  // Мастеру — уведомление.
  const mChat = await masterChatId(master.id);
  if (mChat) {
    const ok = await send(mChat, T.NOTIF_CLIENT_CANCELED(
      client.displayName, all.service?.name || 'услуга', dateStr, time,
    ));
    if (!ok) console.warn('master notify failed');
  }

  // Предложить лист ожидания на это окно.
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.MY_OFFER_WAITLIST,
    reply_markup: waitlistOfferMenu(master.masterCode),
  });

  // Уведомить тех, кто ждал этот день (spec §11): одна заявка = одно уведомление.
  await notifyWaitlist(master, dateStr, nowSec);
}

async function dayAppointmentsForAp(master, apId) {
  const row = await getAppointment(master.id, apId);
  if (!row) return null;
  const [enriched] = await enrich(master.id, [row]);
  return enriched;
}

async function dbSelectAp(master, apId) {
  return getAppointment(master.id, apId);
}

// ---------- Отзывы ----------

async function showReviewList(chatId, master, from) {
  const client = await clientOfMaster(master, from);
  if (!client) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.RV_NONE }));
  const list = await reviewable(master, client.id);
  if (!list.length) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.RV_NONE }));
  }
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.RV_ASK_AP,
    reply_markup: reviewListMenu(master.masterCode, list, fmtDate),
  });
}

async function askStars(chatId, master, from, apId) {
  const client = await clientOfMaster(master, from);
  const ap = await dbSelectAp(master, apId);
  if (!client || !ap) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
  const [enriched] = await enrich(master.id, [ap]);
  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: T.RV_ASK_STARS(enriched.service?.name || 'услуга', apDate(ap, master.timezone)),
    reply_markup: starsMenu(master.masterCode, apId),
  });
}

export async function bkTextInput(chatId, userId, state, text, from) {
  const d = state.data || {};
  if (state.state === 'rv:text') {
    const master = await getMasterByCode(d.code);
    await clearState(chatId);
    if (!master) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    const client = await clientOfMaster(master, from);
    const res = await submitReview(master, d.apId, client.id, d.rating, text === '-' ? null : text);
    if (!res.ok) {
      const msg = res.reason === 'ALREADY' ? T.RV_ALREADY : T.ERR;
      return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: msg }));
    }
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.RV_THANKS }));
  }
  return false;
}

// ---------- Роутер кнопок ----------

export async function bkCallback(cq, action, arg, from, nowSec) {
  const chatId = cq.message.chat.id;
  const parts = String(arg ?? '').split(':');
  const code = parts[0];
  const master = await getMasterByCode(code);
  if (!master) {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MASTER_NOT_FOUND }));
  }

  if (action === 'card') return void (await showCard(chatId, master, from));
  if (action === 'go') return void (await showServices(chatId, master));
  if (action === 'sv') return void (await showDates(chatId, master, Number(parts[1]), nowSec));
  if (action === 'dt') {
    return void (await showSlots(chatId, master, Number(parts[1]), parts[2], nowSec));
  }
  if (action === 'sl') {
    return void (await showConfirm(chatId, master, Number(parts[1]), parts[2], Number(parts[3])));
  }
  if (action === 'ok') {
    return void (await finalizeBook(
      chatId, master, from, Number(parts[1]), parts[2], Number(parts[3]), nowSec,
    ));
  }
  if (action === 'my') return void (await showMy(chatId, master, from));
  if (action === 'cn') return void (await cancelFlow(chatId, master, from, Number(parts[1]), nowSec, false));
  if (action === 'cy') return void (await cancelFlow(chatId, master, from, Number(parts[1]), nowSec, true));

  if (action === 'wl') {
    const client = await clientOfMaster(master, from);
    if (!client) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.MY_EMPTY }));
    const today = new Date().toISOString().slice(0, 10);
    const res = await addToWaitlist(master, client.id, {
      serviceId: null,
      dateFrom: today,
      dateTo: addDaysStr(today, 30),
    });
    await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: res.ok ? T.MY_WAITLIST_ADDED : T.MY_WAITLIST_ALREADY,
    });
    return;
  }

  if (action === 'rv') return void (await showReviewList(chatId, master, from));
  if (action === 'ra') return void (await askStars(chatId, master, from, Number(parts[1])));
  if (action === 'rs') {
    const apId = Number(parts[1]);
    const rating = Number(parts[2]);
    const client = await clientOfMaster(master, from);
    if (!client) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));
    await setState(chatId, from.id, 'rv:text', { code, apId, rating });
    return void (await api.sendMessage({
      chat_id: chatId,
      parse_mode: 'HTML',
      text: T.RV_ASK_TEXT('⭐'.repeat(rating)),
    }));
  }
}

// ---------- Уведомление листа ожидания ----------

export async function notifyWaitlist(master, dateStr, nowSec) {
  const entries = await waitlistForDate(master.id, dateStr);
  for (const e of entries) {
    const chatId = await clientChatId(e.clientId);
    if (!chatId) continue;
    const ok = await send(chatId, T.WAITLIST_OFFER(dateStr));
    if (ok) await markWaitlistNotified(e.id);
  }
}

// ---------- Мастер: принять/отклонить заявку ----------

export async function mreqCallback(cq, action, arg, master, nowSec) {
  const chatId = cq.message.chat.id;
  const apId = Number(arg);

  const ap = await getAppointment(master.id, apId);
  if (!ap) return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.ERR }));

  if (ap.status !== 'pending') {
    return void (await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.AP_STATUS_SET(ap.status) }));
  }

  const status = action === 'ac' ? 'confirmed' : 'canceled';
  await setStatus(master.id, apId, status, nowSec);

  const [enriched] = await enrich(master.id, [ap]);
  const dateStr = apDate(ap, master.timezone);
  const time = minToHHMM(localMin(master.timezone, ap.startsAt));
  const svcName = enriched.service?.name || 'услуга';

  await api.sendMessage({
    chat_id: chatId,
    parse_mode: 'HTML',
    text: action === 'ac' ? T.NOTIF_ACCEPTED : T.NOTIF_REJECTED,
  });

  // Клиенту — результат.
  const cChat = await clientChatId(ap.clientId);
  if (cChat) {
    const clientText = action === 'ac'
      ? T.CLIENT_AP_CONFIRMED(svcName, dateStr, time)
      : T.CLIENT_AP_REJECTED(svcName, dateStr, time);
    await send(cChat, clientText);
  } else {
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text: T.NOTIF_CLIENT_GONE });
  }

  // Отклонение освобождает окно → предложить ожидающим.
  if (action === 'rj') await notifyWaitlist(master, dateStr, nowSec);
}

function addDaysStr(dateStr, n) {
  const t = new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}