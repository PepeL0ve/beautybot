// lib/svc/sweep.js — единый прогон отложенных задач (spec §13).
// Вызывается /tick (cron каждые 5 мин) и лениво при обращении мастера.

import { api, db } from 'sdk';
import { masters } from '../../schema.js';
import { withDefaults } from './settings.js';
import { deliverDue, lostClientsDigest, birthdayDigest, planWaitlistOffers } from './reminders.js';
import { pendingMailings, sendChunk } from './mailings.js';
import { localDate, addDays } from '../time.js';

export async function runSweep(nowSec) {
  const res = {
    reminders: { sent: 0, failed: 0 },
    digests: { lost: 0, birthdays: 0 },
    waitlist: 0,
    mailings: { processed: 0, sent: 0, failed: 0 },
  };

  // 1. Доставка просроченных напоминаний (ap_before, pending_stale, waitlist_offer)
  const due = await deliverDue(nowSec, send);
  res.reminders = due;

  // 2. Дайджесты и продолжение рассылок — по каждому мастеру
  for (const m of await db.select().from(masters).all()) {
    m.settings = withDefaults(m.settings);

    // 2a. Дайджест «потеряшек» — раз в сутки
    const lost = await lostClientsDigest(m.id, nowSec);
    if (lost && lost.count) {
      const mChat = m.settings.admin_chat_id || m.tgChatId;
      if (mChat) {
        const lines = lost.names.map((n) => `• ${n}`);
        const ok = await send(
          mChat,
          `😴 <b>Клиенты-«потеряшки»</b> (${lost.count})\n\n${lines.join('\n')}\n\nОтправьте им готовый текст — кнопка в карточке клиента.`,
        );
        if (ok) res.digests.lost++;
      }
    }

    // 2b. Дни рождения
    const bdays = await birthdayDigest(m.id, nowSec);
    if (bdays) {
      for (const c of bdays.today) {
        const chatId = c.tgChatId || c.tgUserId;
        if (chatId) {
          const ok = await send(chatId, `🎂 С днём рождения! Пусть этот год будет прекрасным. С любовью, ${m.name}.`);
          if (ok) res.digests.birthdays++;
        }
      }
      // Завтрашние — мастеру в дайджест
      if (bdays.tomorrow.length) {
        const mChat = m.settings.admin_chat_id || m.tgChatId;
        if (mChat) {
          const names = bdays.tomorrow.map((c) => c.displayName).join(', ');
          await send(mChat, `🎂 Завтра дни рождения: ${names}`);
        }
      }
    }

    // 2c. Лист ожидания — проверяем вчерашний и сегодняшний дни
    const today = localDate(m.timezone, nowSec);
    for (const dateStr of [addDays(today, -1), today]) {
      const n = await planWaitlistOffers(m.id, dateStr, nowSec);
      res.waitlist += n;
    }

    // 2d. Продолжение незавершённых рассылок
    const pending = await pendingMailings(m.id);
    for (const mailing of pending) {
      const r = await sendChunk(mailing, m, send);
      res.mailings.processed++;
      res.mailings.sent += r.sent || 0;
      res.mailings.failed += r.failed || 0;
    }
  }

  return res;
}

// Отправка с обработкой ошибок (403 → недостижим).
async function send(chatId, text) {
  try {
    await api.sendMessage({ chat_id: chatId, parse_mode: 'HTML', text });
    return true;
  } catch (e) {
    console.warn('sweep send failed', e?.description || e);
    return false;
  }
}